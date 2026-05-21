"""CP-SAT ders programı çözücüsü (Google OR-Tools).

Girdi payload:
{
  classes: [cls, ...],
  teachers: [{id, name, branch, extraBranches, allowedGroups, offDays}, ...],
  load: {colKey: {course: hours}},
  maxWeekly: int,
  blocks: {cls: [[day, slotA, slotB], ...]},   # classBlockPairs(cls) çıktısı (frontend)
  colKey: {cls: key},                           # colKeyFor(cls) (frontend)
  group:  {cls: 'ortaokul'|'lise'|'mezun'},     # classToGroup(cls) (frontend)
}

Çıktı:
{
  assigned: [{cls, course, teacherId, teacherName, day, slot}, ...],  # her slot ayrı satır
  unplaced: [{cls, course, reason}, ...],
  tLoad:    {teacherId: blokSayısı},
  ms:       int,
}
"""

import time
from ortools.sat.python import cp_model

from solver.domain import eligible_teachers, course_branch

# Objective ağırlıkları: önce her şeyi yerleştir, sonra aşımı kıs, sonra dengele
W_UNPLACED = 100000
W_OVER = 100
W_BALANCE = 1

TIME_LIMIT_SECONDS = 30
NUM_WORKERS = 8


def solve(payload):
    t0 = time.time()

    classes = payload['classes']
    teachers = payload['teachers']
    load = payload.get('load', {})
    max_weekly = payload.get('maxWeekly', 40)
    blocks_by_cls = payload.get('blocks', {})
    colkey_by_cls = payload.get('colKey', {})
    group_by_cls = payload.get('group', {})

    teacher_by_id = {t['id']: t for t in teachers}

    assigned = []
    unplaced = []

    model = cp_model.CpModel()

    # ── Ders birimleri (units) ──
    # unit = (cls, course, block_idx). Her unit bir bloğa + (cls,course üzerinden) bir öğretmene.
    units = []                 # [(cls, course)]  block_idx ima edilir, units_of ile gruplanır
    units_of_cc = {}           # (cls, course) -> [unit_index, ...]
    eligible_of_cc = {}        # (cls, course) -> [teacherId, ...]
    blocks_per_cc = {}         # (cls, course) -> B (blok sayısı)

    for cls in classes:
        key = colkey_by_cls.get(cls)
        grp = group_by_cls.get(cls)
        cc_load = load.get(key, {}) if key else {}
        for course, hours in cc_load.items():
            hours = int(hours or 0)
            if hours <= 0:
                continue
            if hours % 2 != 0:
                unplaced.append({'cls': cls, 'course': course, 'reason': 'tek saat, blok yapılamaz'})
                continue
            elig = eligible_teachers(teachers, course, grp)
            if not elig:
                # her blok için bir unplaced satırı
                for _ in range(hours // 2):
                    unplaced.append({'cls': cls, 'course': course,
                                     'reason': 'uygun öğretmen yok (branş: %s)' % course_branch(course)})
                continue
            B = hours // 2
            cc = (cls, course)
            eligible_of_cc[cc] = elig
            blocks_per_cc[cc] = B
            idxs = []
            for _bi in range(B):
                idxs.append(len(units))
                units.append(cc)
            units_of_cc[cc] = idxs

    # Çözülecek bir şey yoksa erken dön
    if not units_of_cc:
        return {'assigned': [], 'unplaced': unplaced,
                'tLoad': {t['id']: 0 for t in teachers},
                'ms': int((time.time() - t0) * 1000)}

    # ── Karar değişkenleri ──
    # x[u][p] : unit u, sınıfının blok havuzundaki p indeksli bloğa atandı mı
    x = {}
    placed = {}
    pool_of_unit = {}  # u -> blok havuzu (cls'in blocks listesi)
    for u, (cls, course) in enumerate(units):
        pool = blocks_by_cls.get(cls, [])
        pool_of_unit[u] = pool
        x[u] = [model.NewBoolVar('x_%d_%d' % (u, p)) for p in range(len(pool))]
        placed[u] = model.NewBoolVar('placed_%d' % u)
        # u ya tam 1 bloğa ya hiçbirine
        model.Add(sum(x[u]) == placed[u])

    # y[(cls,course)][t] : bu sınıf-dersi öğretmen t veriyor mu (sadece eligible)
    y = {}
    for cc, elig in eligible_of_cc.items():
        y[cc] = {t: model.NewBoolVar('y_%s_%s_%s' % (cc[0], cc[1], t)) for t in elig}
        # tek öğretmen kuralı (HARD): tam 1 öğretmen seçilir
        model.AddExactlyOne(list(y[cc].values()))

    # ── HARD: K3 — aynı sınıf+ders aynı günde en fazla 1 blok ──
    for cc, idxs in units_of_cc.items():
        cls = cc[0]
        pool = blocks_by_cls.get(cls, [])
        days = sorted(set(b[0] for b in pool))
        for d in days:
            terms = []
            for u in idxs:
                for p, b in enumerate(pool):
                    if b[0] == d:
                        terms.append(x[u][p])
            if terms:
                model.Add(sum(terms) <= 1)

    # ── HARD: K5 — bir sınıf aynı (gün,slot)'ta en fazla 1 ders ──
    # units'i sınıfa göre grupla
    units_by_cls = {}
    for u, (cls, course) in enumerate(units):
        units_by_cls.setdefault(cls, []).append(u)
    for cls, us in units_by_cls.items():
        pool = blocks_by_cls.get(cls, [])
        # (gün, slot) -> kaplayan x değişkenleri
        cover = {}
        for u in us:
            for p, b in enumerate(pool):
                day, sA, sB = b[0], b[1], b[2]
                for s in (sA, sB):
                    cover.setdefault((day, s), []).append(x[u][p])
        for ds, terms in cover.items():
            if len(terms) > 1:
                model.Add(sum(terms) <= 1)

    # ── HARD: K6 — öğretmen izin günü → o gün ders yok ──
    # z lineerleştirmesi K4 için zaten kurulacak; izin gününü de z üzerinden engelle.
    # z[(u,p,t)] = x[u][p] AND y[cc][t]
    z = {}
    def get_z(u, p, t, cc):
        keyz = (u, p, t)
        if keyz in z:
            return z[keyz]
        zv = model.NewBoolVar('z_%d_%d_%s' % (u, p, t))
        model.Add(zv <= x[u][p])
        model.Add(zv <= y[cc][t])
        model.Add(zv >= x[u][p] + y[cc][t] - 1)
        z[keyz] = zv
        return zv

    # ── HARD: K4 — öğretmen aynı (gün,slot)'ta en fazla 1 sınıf ──
    # Her öğretmen için (gün,slot) -> kaplayan z değişkenleri
    for cc, idxs in units_of_cc.items():
        cls = cc[0]
        pool = blocks_by_cls.get(cls, [])
        elig = eligible_of_cc[cc]
        for t in elig:
            off = set(teacher_by_id[t].get('offDays') or [])
            for u in idxs:
                for p, b in enumerate(pool):
                    day = b[0]
                    if day in off:
                        # izin günü: bu blok bu öğretmene yasak → x AND y olamaz
                        model.AddBoolOr([x[u][p].Not(), y[cc][t].Not()])

    # K4 çakışma toplamları: (t, day, slot) -> z listesi
    teacher_slot_cover = {}
    for cc, idxs in units_of_cc.items():
        cls = cc[0]
        pool = blocks_by_cls.get(cls, [])
        elig = eligible_of_cc[cc]
        for t in elig:
            off = set(teacher_by_id[t].get('offDays') or [])
            for u in idxs:
                for p, b in enumerate(pool):
                    day, sA, sB = b[0], b[1], b[2]
                    if day in off:
                        continue  # zaten yasaklandı
                    zv = get_z(u, p, t, cc)
                    for s in (sA, sB):
                        teacher_slot_cover.setdefault((t, day, s), []).append(zv)
    for tds, terms in teacher_slot_cover.items():
        if len(terms) > 1:
            model.Add(sum(terms) <= 1)

    # ── SOFT: öğretmen yükü, aşım, denge ──
    # load_t = sum over (cls,course) of B * y[cc][t]  (z'siz, lineer)
    load_vars = {}
    over_vars = {}
    # üst sınır: tüm bloklar tek öğretmene
    total_blocks = sum(blocks_per_cc.values())
    for t in teacher_by_id:
        terms = []
        for cc, elig in eligible_of_cc.items():
            if t in y[cc]:
                terms.append(blocks_per_cc[cc] * y[cc][t])
        lv = model.NewIntVar(0, total_blocks, 'load_%s' % t)
        if terms:
            model.Add(lv == sum(terms))
        else:
            model.Add(lv == 0)
        load_vars[t] = lv
        ov = model.NewIntVar(0, total_blocks, 'over_%s' % t)
        model.Add(ov >= lv - max_weekly)
        model.Add(ov >= 0)
        over_vars[t] = ov

    peak = model.NewIntVar(0, total_blocks, 'peak')
    model.AddMaxEquality(peak, list(load_vars.values()))

    # ── Objective ──
    unplaced_terms = []
    for u in range(len(units)):
        # (1 - placed[u]) minimize
        unplaced_terms.append(1 - placed[u])
    model.Minimize(
        W_UNPLACED * sum(unplaced_terms)
        + W_OVER * sum(over_vars.values())
        + W_BALANCE * peak
    )

    # ── Çöz ──
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = TIME_LIMIT_SECONDS
    solver.parameters.num_search_workers = NUM_WORKERS
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # çözüm yok: tüm units unplaced
        for cc, idxs in units_of_cc.items():
            for _u in idxs:
                unplaced.append({'cls': cc[0], 'course': cc[1], 'reason': 'çözüm bulunamadı'})
        return {'assigned': [], 'unplaced': unplaced,
                'tLoad': {t['id']: 0 for t in teachers},
                'ms': int((time.time() - t0) * 1000)}

    # ── Çözümü oku ──
    # (cls,course) -> seçilen öğretmen
    chosen_teacher = {}
    for cc, tmap in y.items():
        for t, var in tmap.items():
            if solver.Value(var) == 1:
                chosen_teacher[cc] = t
                break

    for u, (cls, course) in enumerate(units):
        if solver.Value(placed[u]) == 0:
            unplaced.append({'cls': cls, 'course': course, 'reason': 'yerleştirilemedi (çakışma/kapasite)'})
            continue
        pool = pool_of_unit[u]
        chosen_p = None
        for p in range(len(pool)):
            if solver.Value(x[u][p]) == 1:
                chosen_p = p
                break
        if chosen_p is None:
            unplaced.append({'cls': cls, 'course': course, 'reason': 'yerleştirilemedi'})
            continue
        day, sA, sB = pool[chosen_p][0], pool[chosen_p][1], pool[chosen_p][2]
        tid = chosen_teacher.get((cls, course))
        tname = teacher_by_id[tid]['name'] if tid in teacher_by_id else ''
        # her blok = 2 slot → 2 ayrı assigned satırı (JS sözleşmesi)
        for s in (sA, sB):
            assigned.append({'cls': cls, 'course': course, 'teacherId': tid,
                             'teacherName': tname, 'day': day, 'slot': s})

    # tLoad: çözücüden gerçek yük (blok sayısı)
    tload = {}
    for t in teacher_by_id:
        tload[t] = int(solver.Value(load_vars[t]))

    return {'assigned': assigned, 'unplaced': unplaced, 'tLoad': tload,
            'ms': int((time.time() - t0) * 1000)}
