"""CP-SAT ders programı çözücüsü (Google OR-Tools).

Girdi payload:
{
  classes: [cls, ...],
  teachers: [{id, name, branches, allowedGroups, offDays}, ...],
  load: {colKey: {course: hours}},
  pieces: {colKey: {course: [L, ...]}},        # opsiyonel — gruplama deseni (örn 7 saat → [3,2,2]);
                                               #   yoksa saatten varsayılan türetilir (2'liler + tek kalan 1)
  maxWeekly: int,                              # öğretmen haftalık saat hedefi (soft aşım cezası)
  windows: {cls: {day: [slotIdx, ...]}},       # sınıfın gün→ardışık slot penceresi (öncelikli)
  blocks: {cls: [[day, slotA, slotB], ...]},   # ESKİ sözleşme — windows yoksa bundan türetilir
  colKey: {cls: key},                          # colKeyFor(cls) (frontend)
  group:  {cls: 'ortaokul'|'lise'|'mezun'},    # classToGroup(cls) (frontend)
  teacherSlots: {tid: [[day, slotIdx], ...]},  # KATI mod (Özellik 1)
  presets: [{teacherId, cls, course}, ...],    # HARD kilit (Özellik 2)
}

Çıktı:
{
  assigned: [{cls, course, teacherId, teacherName, day, slot}, ...],  # her SAAT ayrı satır
  unplaced: [{cls, course, reason}, ...],      # her grup (parça) için bir satır
  tLoad:    {teacherId: saat},                 # NOT: 2026-07-08'e dek blok sayısıydı, artık saat
  ms:       int,
}

Grup (parça) modeli: bir dersin haftalık saati parçalara bölünür; her parça AYNI GÜN
içinde L ardışık slottur. Aynı sınıf+ders aynı güne en fazla 1 parça (K3) → 3-2-2
deseni üç farklı güne yayılır. Desen verilmezse 2'li parçalar (+tek kalan saat 1'lik
parça) kullanılır — eski blok davranışıyla uyumlu, tek sayı artık hata değildir.
"""

import time
from ortools.sat.python import cp_model

from solver.domain import eligible_teachers

# Objective ağırlıkları: önce preset'lere uy, sonra her şeyi yerleştir (saat ağırlıklı),
# sonra aşımı kıs, sonra dengele.
# W_PRESET > W_UNPLACED: preset kullanıcının AÇIK isteği — mümkünse mutlaka uygulanır.
# Ama SOFT (hard değil): imkansız bir preset artık tüm modeli INFEASIBLE yapıp "0 yerleşti"
# ile programı çökertmez; yalnız o preset gevşetilir (ceza ödenir) + presetWarnings'e düşer.
W_PRESET = 10000000
W_UNPLACED = 100000
W_OVER = 100
W_BALANCE = 1

TIME_LIMIT_SECONDS = 30
NUM_WORKERS = 8


def default_pieces(hours):
    """Desen verilmemişse: 2'li gruplar + tek kalan saat 1'lik grup."""
    return [2] * (hours // 2) + ([1] if hours % 2 else [])


def parse_pieces(raw, hours):
    """Payload deseni → [L, ...]; geçersiz/boşsa saatten varsayılan türet."""
    if isinstance(raw, (list, tuple)):
        try:
            pat = [int(v) for v in raw if int(v) > 0]
        except (TypeError, ValueError):
            pat = []
        if pat:
            return pat
    return default_pieces(hours)


def windows_from_blocks(blocks):
    """Eski blok sözleşmesinden gün→slot penceresi türet (harness/eski istemci)."""
    out = {}
    for b in blocks or []:
        out.setdefault(int(b[0]), set()).update((int(b[1]), int(b[2])))
    return {d: sorted(s) for d, s in out.items()}


def run_candidates(slots, length, aligned=False):
    """Sıralı slot listesindeki L uzunluklu ARDIŞIK diziler.

    aligned=True → yalnız çift ofsetli başlangıçlar (eski 2'li blok hizası).
    Sınıftaki tüm parçalar çift uzunluklu ise hizalı adaylar kapasite kaybetmez
    ama arama uzayını ciddi küçültür (ölçek testi 30s → saniye altı).
    """
    res = []
    for i in range(len(slots) - length + 1):
        if aligned and i % 2:
            continue
        seg = slots[i:i + length]
        if seg[-1] - seg[0] == length - 1:
            res.append(tuple(seg))
    return res


def solve(payload):
    t0 = time.time()

    classes = payload['classes']
    teachers = payload['teachers']
    load = payload.get('load', {})
    pieces_by_key = payload.get('pieces') or {}
    max_weekly = payload.get('maxWeekly', 40)
    colkey_by_cls = payload.get('colKey', {})
    group_by_cls = payload.get('group', {})

    # Sınıf pencereleri: windows öncelikli, yoksa eski blocks sözleşmesinden türet
    windows_raw = payload.get('windows') or {}
    blocks_by_cls = payload.get('blocks') or {}
    win_by_cls = {}
    for cls in classes:
        w = windows_raw.get(cls)
        if w:
            win_by_cls[cls] = {int(d): sorted(int(s) for s in slots)
                               for d, slots in w.items() if slots}
        else:
            win_by_cls[cls] = windows_from_blocks(blocks_by_cls.get(cls))

    # Özellik 1 (KATI): öğretmen başına işaretli (gün, slotIndex) kümesi.
    # teacherSlots gönderildiyse katı uygulanır: öğretmen sadece bu slotlara atanır,
    # işaretsiz öğretmene (boş set) hiç ders verilmez.
    teacher_slots_raw = payload.get('teacherSlots') or {}
    avail = {tid: set(tuple(p) for p in pairs) for tid, pairs in teacher_slots_raw.items()}
    strict_mode = len(teacher_slots_raw) > 0

    def piece_ok(t, day, seg):
        # parça (day, seg) öğretmen t'ye uygun mu (TÜM slotları available)
        if not strict_mode:
            return True
        av = avail.get(t, set())
        return all((day, s) in av for s in seg)

    # Özellik 2: ön eşleştirme kilitleri [{teacherId, cls, course}]
    presets = payload.get('presets') or []

    teacher_by_id = {t['id']: t for t in teachers}

    assigned = []
    unplaced = []
    preset_warnings = []

    model = cp_model.CpModel()

    # ── Ders birimleri (units) ──
    # unit = (cls, course, L): dersin L saatlik TEK parçası. Parça bir güne, ardışık
    # L slota ve (cls,course üzerinden) bir öğretmene atanır.
    units = []                 # [(cls, course, L)]
    units_of_cc = {}           # (cls, course) -> [unit_index, ...]
    eligible_of_cc = {}        # (cls, course) -> [teacherId, ...]
    hours_of_cc = {}           # (cls, course) -> toplam saat (desen toplamı)

    for cls in classes:
        key = colkey_by_cls.get(cls)
        grp = group_by_cls.get(cls)
        cc_load = load.get(key, {}) if key else {}
        pats = pieces_by_key.get(key, {}) if key else {}
        for course, hours in cc_load.items():
            hours = int(hours or 0)
            if hours <= 0:
                continue
            pat = parse_pieces(pats.get(course), hours)
            if not pat:
                continue
            elig = eligible_teachers(teachers, course, grp)
            if not elig:
                # her parça için bir unplaced satırı
                for _ in pat:
                    unplaced.append({'cls': cls, 'course': course,
                                     'reason': 'uygun öğretmen yok (ders: %s)' % course})
                continue
            cc = (cls, course)
            eligible_of_cc[cc] = elig
            hours_of_cc[cc] = sum(pat)
            idxs = []
            for length in pat:
                idxs.append(len(units))
                units.append((cls, course, length))
            units_of_cc[cc] = idxs

    # Çözülecek bir şey yoksa erken dön
    if not units_of_cc:
        return {'assigned': [], 'unplaced': unplaced,
                'tLoad': {t['id']: 0 for t in teachers},
                'ms': int((time.time() - t0) * 1000)}

    # Hizalama kararı (sınıf başına): sınıftaki TÜM parçalar çift uzunluklu ise adaylar
    # çift ofsetli başlangıçlara kısıtlanır — kapasite kaybı yok, arama uzayı küçük.
    # Tek uzunluklu parça (1/3/5 saat) varsa o sınıfın tüm adayları serbest, çünkü
    # esnek paketleme (örn 3+3 = 6 slotluk gün) hizasız başlangıç gerektirir.
    free_cls = {}
    for (cls, _course, length) in units:
        if length % 2 == 1:
            free_cls[cls] = True

    # ── Karar değişkenleri ──
    # x[u][p] : unit u, aday yerleşim p=(day, seg)'e atandı mı.
    # Aday havuzu: sınıf penceresindeki her günün L uzunluklu ardışık dizileri.
    x = {}
    placed = {}
    pool_of_unit = {}  # u -> [(day, (slot,...)), ...]
    for u, (cls, course, length) in enumerate(units):
        win = win_by_cls.get(cls, {})
        aligned = not free_cls.get(cls, False)
        pool = [(d, seg) for d in sorted(win)
                for seg in run_candidates(win[d], length, aligned)]
        pool_of_unit[u] = pool
        x[u] = [model.NewBoolVar('x_%d_%d' % (u, p)) for p in range(len(pool))]
        placed[u] = model.NewBoolVar('placed_%d' % u)
        # u ya tam 1 yerleşime ya hiçbirine; havuz boşsa (parça sığmıyor) placed 0'a düşer
        model.Add(sum(x[u]) == placed[u])

    # y[(cls,course)][t] : bu sınıf-dersi öğretmen t veriyor mu (sadece eligible)
    y = {}
    for cc, elig in eligible_of_cc.items():
        y[cc] = {t: model.NewBoolVar('y_%s_%s_%s' % (cc[0], cc[1], t)) for t in elig}
        # tek öğretmen kuralı (HARD): en fazla 1 öğretmen.
        # ExactlyOne yerine AtMostOne — katı modda tüm eligible öğretmenler
        # available'sızsa hiç öğretmen seçilemez (INFEASIBLE değil, ders unplaced).
        model.AddAtMostOne(list(y[cc].values()))
        sum_y = sum(y[cc].values())
        for u in units_of_cc[cc]:
            # öğretmen seçilmediyse (sum_y=0) bu cc'nin hiçbir parçası yerleşemez
            model.Add(placed[u] <= sum_y)

    # ── Özellik 2: ön eşleştirme kilitleri (SOFT — yüksek öncelikli) ──
    # Eskiden model.Add(y[cc][tid]==1) HARD idi: imkansız TEK bir preset (öğretmenin
    # uygun günü sınıf penceresine sığmıyor vb.) tüm modeli INFEASIBLE yapıp "0 yerleşti"
    # ile programı çökertiyordu. Artık her preset için bir "kaçırma" (miss) değişkeni:
    #   y[cc][tid] + miss >= 1  → ya öğretmen atanır (miss=0) ya preset gevşer (miss=1).
    # Objective miss'i W_PRESET (> W_UNPLACED) ile cezalar → solver mümkünse mutlaka uyar,
    # imkansızsa yalnız o preset'i bırakır, program çökmez. Gevşeyen preset raporlanır.
    preset_miss = []          # objective için (BoolVar listesi)
    preset_miss_info = []      # (miss_var, "insan-okur etiket") — sonradan uyarı üretir
    for pr in presets:
        cc = (pr.get('cls'), pr.get('course'))
        tid = pr.get('teacherId')
        if cc not in eligible_of_cc:
            preset_warnings.append('%s %s: ders programda yok (atlandı)' % (cc[0], cc[1]))
            continue
        if tid not in y[cc]:
            preset_warnings.append('%s %s: seçilen öğretmen bu derse uygun değil (atlandı)' % (cc[0], cc[1]))
            continue
        miss = model.NewBoolVar('preset_miss_%s_%s_%s' % (cc[0], cc[1], tid))
        model.Add(y[cc][tid] + miss >= 1)
        preset_miss.append(miss)
        preset_miss_info.append((miss, cc, tid))

    # ── HARD: K3 — aynı sınıf+ders aynı günde en fazla 1 parça ──
    for cc, idxs in units_of_cc.items():
        days = sorted(win_by_cls.get(cc[0], {}).keys())
        for d in days:
            terms = []
            for u in idxs:
                for p, (day, _seg) in enumerate(pool_of_unit[u]):
                    if day == d:
                        terms.append(x[u][p])
            if len(terms) > 1:
                model.Add(sum(terms) <= 1)

    # ── Simetri kırma: aynı (cls,course) içindeki EŞ uzunluklu parçalar birbirinin ──
    # yerine geçebilir (değiş-tokuş aynı çözüm). Aramayı küçültmek için sıra dayatılır:
    # düşük indeksli parça önce yerleşir ve günü kesin daha erken olur (K3 aynı günü
    # zaten yasaklar). Bu olmadan ölçek testi 30s limitine çarpıyordu.
    day_expr = {}

    def day_of(u):
        if u not in day_expr:
            day_expr[u] = sum((d + 1) * x[u][p]
                              for p, (d, _seg) in enumerate(pool_of_unit[u]))
        return day_expr[u]

    for cc, idxs in units_of_cc.items():
        by_len = {}
        for u in idxs:
            by_len.setdefault(units[u][2], []).append(u)
        for us in by_len.values():
            for ua, ub in zip(us, us[1:]):
                model.Add(placed[ub] <= placed[ua])
                # ub yerleştiyse günü ua'dan kesin sonra; ub açıktaysa kısıt gevşer
                # (8 > maks D = 7 [Pazar günü+1] — ua Pazar'dayken bile 7 ≤ -1+8 sağlanır)
                model.Add(day_of(ua) <= day_of(ub) - 1 + 8 * (1 - placed[ub]))

    # ── HARD: K5 — bir sınıf aynı (gün,slot)'ta en fazla 1 ders ──
    units_by_cls = {}
    for u, (cls, course, _length) in enumerate(units):
        units_by_cls.setdefault(cls, []).append(u)
    for cls, us in units_by_cls.items():
        # (gün, slot) -> kaplayan x değişkenleri
        cover = {}
        for u in us:
            for p, (day, seg) in enumerate(pool_of_unit[u]):
                for s in seg:
                    cover.setdefault((day, s), []).append(x[u][p])
        for ds, terms in cover.items():
            if len(terms) > 1:
                model.Add(sum(terms) <= 1)

    # (Eski K7 "sınıf-gün saat üst sınırı / dayLimits" kaldırıldı — sınıf başına KATI
    #  windows, o günün ders penceresini zaten sınırlıyor. Ayrı limit tablosu gerekmiyor.)

    # ── HARD: K6 (izin günü) + Özellik 1 (aktif slot) — parça-öğretmen yasakları ──
    # z[(u,p,t)] = x[u][p] AND y[cc][t] lineerleştirmesi, öğretmen çakışması (K4) için.
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

    # Bir parça p, öğretmen t'ye uygun değilse (izin günü VEYA katı modda işaretsiz slot)
    # x[u][p] AND y[cc][t] olamaz. Uygunsa z üzerinden K4 çakışma toplamına girer.
    teacher_slot_cover = {}  # (t, day, slot) -> z listesi
    for cc, idxs in units_of_cc.items():
        elig = eligible_of_cc[cc]
        for t in elig:
            off = set(teacher_by_id[t].get('offDays') or [])
            for u in idxs:
                for p, (day, seg) in enumerate(pool_of_unit[u]):
                    if day in off or not piece_ok(t, day, seg):
                        model.AddBoolOr([x[u][p].Not(), y[cc][t].Not()])
                        continue
                    zv = get_z(u, p, t, cc)
                    for s in seg:
                        teacher_slot_cover.setdefault((t, day, s), []).append(zv)
    for tds, terms in teacher_slot_cover.items():
        if len(terms) > 1:
            model.Add(sum(terms) <= 1)

    # ── SOFT: öğretmen yükü (SAAT), aşım, denge ──
    # load_t = sum over (cls,course) of saat * y[cc][t]  (z'siz, lineer)
    load_vars = {}
    over_vars = {}
    total_hours = sum(hours_of_cc.values())  # üst sınır: tüm dersler tek öğretmene
    for t in teacher_by_id:
        terms = []
        for cc, elig in eligible_of_cc.items():
            if t in y[cc]:
                terms.append(hours_of_cc[cc] * y[cc][t])
        lv = model.NewIntVar(0, total_hours, 'load_%s' % t)
        if terms:
            model.Add(lv == sum(terms))
        else:
            model.Add(lv == 0)
        load_vars[t] = lv
        ov = model.NewIntVar(0, total_hours, 'over_%s' % t)
        model.Add(ov >= lv - max_weekly)
        model.Add(ov >= 0)
        over_vars[t] = ov

    peak = model.NewIntVar(0, total_hours, 'peak')
    model.AddMaxEquality(peak, list(load_vars.values()))

    # ── Fizibilite testi modu (Kesin Kontrol) ──
    # feasibilityTest=True → "TÜM dersler yerleşmek ZORUNDA" (placed=1 hard) + presetler
    # hard. Status ham döner: FEASIBLE = tam yerleşim mümkün, INFEASIBLE = geometrik
    # olarak imkansız (toplam saat tutsa bile dizilim yok). Öneri üretimi için çağıran
    # (route) bu testi farklı senaryolarla (öğretmen müsaitliği genişletilmiş) tekrarlar.
    feasibility_test = bool(payload.get('feasibilityTest'))
    if feasibility_test:
        for u in range(len(units)):
            model.Add(placed[u] == 1)
        for miss in preset_miss:
            model.Add(miss == 0)  # presetler de zorunlu (gerçek durumu test et)
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = payload.get('timeLimit', TIME_LIMIT_SECONDS)
        solver.parameters.num_search_workers = NUM_WORKERS
        status = solver.Solve(model)
        feasible = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        return {
            'feasibilityTest': True,
            'feasible': feasible,
            'status': solver.StatusName(status),
            'totalUnits': len(units),
            'ms': int((time.time() - t0) * 1000),
        }

    # ── Objective ──
    # Açıkta kalan parçalar SAAT ağırlıklı cezalandırılır (3 saatlik parça 1 saatlikten önemli).
    unplaced_terms = []
    for u, (_cls, _course, length) in enumerate(units):
        unplaced_terms.append(length * (1 - placed[u]))
    model.Minimize(
        W_PRESET * sum(preset_miss)
        + W_UNPLACED * sum(unplaced_terms)
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
                'presetWarnings': preset_warnings,
                'ms': int((time.time() - t0) * 1000)}

    # ── Gevşeyen (uygulanamayan) preset'leri raporla ──
    # miss=1 → solver o preset'i sağlayamadı (imkansızdı) ama HARD olmadığı için
    # program çökmedi; kullanıcıya hangi presetin atlandığını bildir.
    for miss, cc, tid in preset_miss_info:
        if solver.Value(miss) == 1:
            tname = teacher_by_id[tid]['name'] if tid in teacher_by_id else tid
            preset_warnings.append(
                '%s → %s %s: uygun gün/saat bulunamadığından ön eşleştirme uygulanamadı'
                % (tname, cc[0], cc[1]))

    # ── Çözümü oku ──
    # (cls,course) -> seçilen öğretmen
    chosen_teacher = {}
    for cc, tmap in y.items():
        for t, var in tmap.items():
            if solver.Value(var) == 1:
                chosen_teacher[cc] = t
                break

    # (cls,course) → öğretmen uygunluğuyla erişilebilir günler (izin + katı mod süzülür).
    # Açıkta kalan parçalara AÇIKLAYICI neden üretmek için: uygun gün sayısı parça
    # sayısından azsa asıl kısıt K3+uygunluktur, genel "çakışma" mesajı yanıltır.
    _fdays_cache = {}

    def cc_feasible_days(cc):
        if cc in _fdays_cache:
            return _fdays_cache[cc]
        days = set()
        for u in units_of_cc.get(cc, []):
            for (day, seg) in pool_of_unit[u]:
                if day in days:
                    continue
                for t in eligible_of_cc.get(cc, []):
                    if day in set(teacher_by_id[t].get('offDays') or []):
                        continue
                    if piece_ok(t, day, seg):
                        days.add(day)
                        break
        _fdays_cache[cc] = days
        return days

    for u, (cls, course, length) in enumerate(units):
        if solver.Value(placed[u]) == 0:
            cc = (cls, course)
            n_pieces = len(units_of_cc.get(cc, []))
            fdays = cc_feasible_days(cc)
            if not pool_of_unit[u]:
                reason = 'grup havuza sığmıyor (%d saat ardışık pencere yok)' % length
            elif strict_mode and not fdays:
                reason = 'müsait slot yok (katı mod — uygun öğretmen hiçbir gün işaretli değil)'
            elif len(fdays) < n_pieces:
                reason = ('aynı derse %d grup için öğretmen uygunluğu yalnız %d güne izin veriyor'
                          % (n_pieces, len(fdays)))
            else:
                reason = 'yerleştirilemedi (çakışma/kapasite)'
            unplaced.append({'cls': cls, 'course': course, 'reason': reason})
            continue
        chosen = None
        for p in range(len(pool_of_unit[u])):
            if solver.Value(x[u][p]) == 1:
                chosen = pool_of_unit[u][p]
                break
        if chosen is None:
            unplaced.append({'cls': cls, 'course': course, 'reason': 'yerleştirilemedi'})
            continue
        day, seg = chosen
        tid = chosen_teacher.get((cls, course))
        tname = teacher_by_id[tid]['name'] if tid in teacher_by_id else ''
        # parçanın her saati ayrı assigned satırı (JS sözleşmesi)
        for s in seg:
            assigned.append({'cls': cls, 'course': course, 'teacherId': tid,
                             'teacherName': tname, 'day': day, 'slot': s})

    # tLoad: gerçekte YERLEŞEN saat. load_vars kullanılmaz — o, seçilen (cls,ders)
    # çiftinin TÜM desen saatini sayar; parçası açıkta kalan derste fazla gösterirdi.
    tload = {t: 0 for t in teacher_by_id}
    for a in assigned:
        if a['teacherId'] in tload:
            tload[a['teacherId']] += 1

    return {'assigned': assigned, 'unplaced': unplaced, 'tLoad': tload,
            'presetWarnings': preset_warnings,
            'ms': int((time.time() - t0) * 1000)}
