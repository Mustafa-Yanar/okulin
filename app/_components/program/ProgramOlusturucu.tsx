'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles, AlertTriangle, Check, Save, ShieldCheck } from 'lucide-react';
import { classToGroup } from '@/lib/constants';
import TeacherPresets from '../director/TeacherPresets';
import { useConfirm } from '../ConfirmProvider';
import { useClasses } from '../ClassesContext';
import LoadTable from './LoadTable';
import ResultView from './ResultView';
import PrintPreview from './PrintPreview';
import type { Branding } from '@/lib/branding';
import type { ShowToast, TeacherDTO, TeacherPresetDTO } from '../types';
import type {
  ApiFn, Load, Grouping, Windows, TeacherSlots, SolveResult, SolveResponse,
  ProgramGrid, FeasFix, SwapFix, DayGap, FeasResult, SolvePayload, LockedLesson,
} from './program-types';
import {
  DAYS, LOAD_COLUMNS, colKeyFor, coursesForColFromRegistry, colKeyFromRegistry,
  SOLVER_GROUPS, windowsFromTemplate, parsePattern, slotIdFor, feasSuggestion,
  currentWeekKey, teacherGroups, fetchTeacherSlots, fetchManualLessons, analyzeLoad,
} from './program-logic';

// Ders adı = branş adı; otomatik eşleme yok (çoklu branş modeli).

interface ProgramOlusturucuProps {
  api: ApiFn;
  showToast: ShowToast; // TeacherPresets zorunlu ister; panel her zaman geçer
  branding?: Branding | null;
  // DirectorPanel geçiriyor ama bileşen kullanmıyor (registry tek kaynak) — ölü prop.
  activeClasses?: string[];
}

// ── Ana bileşen ──
export default function ProgramOlusturucu({ api, showToast, branding }: ProgramOlusturucuProps) {
  const confirm = useConfirm();
  const { classes: registryClasses, loaded: registryLoaded } = useClasses();
  const [teachers, setTeachers] = useState<TeacherDTO[] | null>(null);
  // Ders yükü BOŞ başlar (tüm değerler 0) — kaydedilmiş plan varsa config'ten yüklenir.
  const [load, setLoad]         = useState<Load>({});
  const [grouping, setGrouping] = useState<Grouping>({}); // {colKey: {ders: "3-2-2"}} — gruplama override
  const [result, setResult]     = useState<SolveResult | null>(null);
  const [maxWeekly, setMaxWeekly] = useState(40);
  const [planDirty, setPlanDirty] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying]   = useState(false);
  const [clearing, setClearing]   = useState(false);
  const [conflicts, setConflicts] = useState<{ items: string[]; checked: boolean } | null>(null);
  const [preview, setPreview]     = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [analysis, setAnalysis]   = useState<ReturnType<typeof analyzeLoad> | null>(null);
  const [presetTeacherId, setPresetTeacherId] = useState(''); // ön eşleştirme paneli (madde 11)
  const [feasChecking, setFeasChecking] = useState(false);   // Kesin Kontrol çalışıyor
  const [feasResult, setFeasResult] = useState<FeasResult | null>(null); // {feasible, suggestions:[...]}
  // Oluştur anındaki öğretmen müsaitlikleri — manuel blok taşıma denetimi bunu kullanır
  // (solver'ın gördüğü kaynakla aynı; taşıma kuralları solver kurallarının kopyası).
  const [lastTeacherSlots, setLastTeacherSlots] = useState<TeacherSlots | null>(null);

  const classMeta = useMemo(
    () => new Map((registryClasses || []).map(c => [c.id, c])),
    [registryClasses]
  );

  // Sınıf listesi: kayıtlı şube registry'si TEK kaynak — kurum ne açtıysa o kullanılır
  // (boş/dolu olması engel değil). Registry henüz yüklenmediyse (ilk render) boş liste
  // döner, sabit-kod/öğrenci-türevli fallback'e ASLA düşülmez — aksi halde kurum kendi
  // şubelerini elle açmışken eski 34'lük sabit liste görünür.
  const classes = useMemo(() => {
    if (!registryLoaded) return [];
    const fromRegistry = (registryClasses || [])
      .filter(c => SOLVER_GROUPS.includes(c.group))
      .map(c => c.id);
    return [...new Set(fromRegistry)].sort();
  }, [registryLoaded, registryClasses]);

  // Registry-öncelikli köprüler: özel şubelerde (s_…) sabit-kod ayrıştırma çalışmaz.
  const groupOf = useCallback(
    (cls: string) => classMeta.get(cls)?.group || classToGroup(cls),
    [classMeta]
  );
  const colKeyOf = useCallback((cls: string) => {
    const c = classMeta.get(cls);
    if (c) return colKeyFromRegistry(c) || (/^s_/.test(cls) ? null : colKeyFor(cls));
    return colKeyFor(cls);
  }, [classMeta]);
  const labelOf = useCallback(
    (cls: string) => /^s_/.test(cls) ? (classMeta.get(cls)?.ad || cls) : String(cls).toUpperCase(),
    [classMeta]
  );
  // Sınıfın KATI ders penceresi (slotTemplate → {gün: [slotIdx]}). İşaretsizse boş.
  const windowsOf = useCallback(
    (cls: string) => windowsFromTemplate(classMeta.get(cls)?.slotTemplate),
    [classMeta]
  );

  // colKey → gerçek ders listesi (registry'den, kurumun özel dersleri dahil). Sabit
  // COL_COURSES yalnız sütunda hiç sınıf/ders yoksa fallback olarak kullanılır.
  const courseMap = useMemo(
    () => coursesForColFromRegistry(colKeyOf, registryClasses),
    [colKeyOf, registryClasses]
  );
  const coursesOfCol = useCallback((key: string | null) => courseMap[key as string] || [], [courseMap]);

  useEffect(() => {
    (async () => {
      try {
        const data = await api<TeacherDTO[]>('/api/teachers');
        setTeachers(data);
      } catch(e) { showToast?.((e as Error).message,'error'); setTeachers([]); }
    })();
  }, [api, showToast]);

  // Kaydedilmiş planı yükle (haftalık ders yükü + günlük limitler + maks).
  // Config yoksa/boşsa tablo 0'larla kalır.
  useEffect(() => {
    (async () => {
      try {
        const cfg = await api<{ programPlan?: { load?: Load; grouping?: Grouping; maxWeekly?: number } }>('/api/config');
        const plan = cfg?.programPlan || {};
        if (plan.load && Object.keys(plan.load).length) setLoad(plan.load);
        if (plan.grouping && Object.keys(plan.grouping).length) setGrouping(plan.grouping);
        if (plan.maxWeekly) setMaxWeekly(plan.maxWeekly);
      } catch { /* muhasebeci vb. okuyamazsa sessiz — boş tabloyla devam */ }
    })();
  }, [api]);

  // Planı kaydet — sekme değiştirip dönünce girilen değerler kaybolmasın.
  async function savePlan() {
    setSavingPlan(true);
    try {
      await api('/api/config', {
        method: 'PATCH',
        body: JSON.stringify({ patch: { programPlan: { load, grouping, maxWeekly } } }),
      });
      setPlanDirty(false);
      showToast?.('Ders yükü planı kaydedildi', 'success');
    } catch(e) { showToast?.((e as Error).message, 'error'); }
    finally { setSavingPlan(false); }
  }

  // Dirty-işaretli sarmalayıcılar: kullanıcı girişi planı değiştirdi → Kaydet aktifleşir.
  const updateLoad = useCallback((updater: (prev: Load) => Load) => { setLoad(updater); setPlanDirty(true); }, []);
  const updateGrouping = useCallback((updater: (prev: Grouping) => Grouping) => { setGrouping(updater); setPlanDirty(true); }, []);

  // Analizi yeniden hesapla: teachers/load/grouping/classes/pencere değişince.
  // Öğretmen uygunluk (available) verisi de çekilir — Oluştur ile aynı kısıtı görür,
  // aksi halde "hata yok" deyip solver'ın gerçekte açıkta bıraktığı dersleri kaçırır.
  useEffect(() => {
    if (!teachers) return;
    let cancelled = false;
    (async () => {
      const teacherSlots = await fetchTeacherSlots(teachers, api);
      if (cancelled) return;
      setAnalysis(analyzeLoad(classes, load, teachers, grouping, { colKeyOf, groupOf, labelOf, windowsOf, teacherSlots, coursesForCol: coursesOfCol }));
    })();
    return () => { cancelled = true; };
  }, [teachers, load, grouping, classes, colKeyOf, groupOf, labelOf, windowsOf, coursesOfCol, api]);

  // Ders yükü tablosu her zaman tüm sütunları gösterir
  const activeCols = LOAD_COLUMNS;

  // ── CP-SAT çözücü (OR-Tools, Python serverless) ──
  // Kısıtların tümü server'da modellenir; frontend payload'ı hazırlar ve sonucu gösterir.
  // Solver payload'ını kur — hem generate() hem feasibilityCheck() kullanır.
  // teacherSlots dışarıdan verilir (feasibility farklı senaryolar için değiştirir).
  const buildPayload = useCallback((teacherSlots: TeacherSlots, locked?: LockedLesson[]): SolvePayload => {
    const tList = teachers || []; // çağıranlar teachers yüklü olmadan çağırmaz
    const windows: Record<string, Windows> = {}, colKey: Record<string, string | null> = {}, group: Record<string, string | null> = {};
    classes.forEach(c => {
      windows[c] = windowsOf(c);
      colKey[c] = colKeyOf(c);
      group[c] = groupOf(c);
    });
    // "Hayalet talep" temizliği: config'te kalmış ama sınıfların dersler[]'inde
    // olmayan dersleri ayıkla (bkz commit 5d1d9c8).
    const cleanLoad: Load = {};
    for (const [ck, courses] of Object.entries(load)) {
      const valid = new Set(coursesOfCol(ck));
      const filtered: Record<string, number> = {};
      for (const [course, saat] of Object.entries(courses || {})) {
        if (valid.has(course)) filtered[course] = saat;
      }
      if (Object.keys(filtered).length) cleanLoad[ck] = filtered;
    }
    const pieces: Record<string, Record<string, number[]>> = {};
    Object.entries(grouping).forEach(([key, courses]) => {
      Object.entries(courses || {}).forEach(([course, str]) => {
        const pat = parsePattern(str);
        if (pat.length) (pieces[key] = pieces[key] || {})[course] = pat;
      });
    });
    const presets = tList.flatMap(t =>
      (t.presets || []).map(p => ({ teacherId: t.id, cls: p.cls, course: p.course }))
    );
    return { classes, teachers: tList, load: cleanLoad, pieces, maxWeekly, windows, colKey, group, teacherSlots, presets, locked };
  }, [classes, teachers, windowsOf, colKeyOf, groupOf, load, coursesOfCol, grouping, maxWeekly]);

  async function generate() {
    if (!teachers) return;
    setResult(null);
    setConflicts(null);
    setGenerating(true);
    try {
      // KATI mod: her öğretmenin işaretlediği (gün, slotIndex) çiftleri — ön analizle aynı kaynak.
      // Elle atanan dersler (locked) çözücüye SABİT yerleşim olarak gider; çözücü kalanı dağıtır.
      const [teacherSlots, locked] = await Promise.all([
        fetchTeacherSlots(teachers, api),
        fetchManualLessons(teachers, api),
      ]);
      setLastTeacherSlots(teacherSlots);
      const payload = buildPayload(teacherSlots, locked);
      const data = await api<SolveResponse>('/api/program-solve', { method: 'POST', body: JSON.stringify(payload) });
      if (locked.length) showToast?.(`${locked.length} elle atanmış ders sabit tutuldu (ön eşleştirme)`, 'info');

      const assigned = data.assigned || [];
      const unplaced = data.unplaced || [];
      const tLoad = data.tLoad || {};
      teachers.forEach(t => { if (tLoad[t.id] == null) tLoad[t.id] = 0; });

      setResult({ assigned, unplaced, tLoad, total: assigned.length, ms: data.ms ?? 0 });
      // Geçersiz preset uyarıları
      (data.presetWarnings || []).forEach(w => showToast?.(`Ön eşleştirme atlandı: ${w}`, 'info'));
      showToast?.(`${assigned.length} ders yerleşti${unplaced.length ? `, ${unplaced.length} açıkta` : ''}`, unplaced.length ? 'info' : 'success');
    } catch (e) {
      showToast?.((e as Error).message, 'error');
    } finally {
      setGenerating(false);
    }
  }

  // ── Kesin Kontrol: yerleşebilirliği solver'la KESİN test et ──
  // Ön analiz (3b/3c) sınıf-yerel sezgisel; çapraz-sınıf öğretmen çekişmesini yok sayar.
  // Bu buton solver'ı feasibilityTest modunda (tüm dersler zorunlu) çalıştırıp FEASIBLE
  // (yerleşir) / INFEASIBLE (geometrik imkansız) kesin cevabını verir. INFEASIBLE ise
  // hangi öğretmeni tam-güne çıkarmanın çözdüğünü deneyerek somut öneri üretir.
  async function feasibilityCheck() {
    if (!teachers) return;
    setFeasChecking(true);
    setFeasResult(null);
    try {
      const [teacherSlots, locked] = await Promise.all([
        fetchTeacherSlots(teachers, api),
        fetchManualLessons(teachers, api),
      ]);
      const base = buildPayload(teacherSlots, locked);

      // 1) Mevcut durumu kesin test et
      const r0 = await api<SolveResponse>('/api/program-solve', {
        method: 'POST',
        body: JSON.stringify({ ...base, feasibilityTest: true }),
      });
      if (r0.feasible) {
        setFeasResult({ feasible: true, suggestions: [] });
        showToast?.('Tüm dersler yerleşebilir — program tam çözülür', 'success');
        return;
      }

      // 2) INFEASIBLE → darboğazı BELİRTİDEN değil YAPIDAN bul.
      //    "Açıkta kalan ders" her solve'da simetrik dersler (Kimya/Fizik/TYT) arasında
      //    keyfi değişir — ona GÜVENMEYİZ. Bunun yerine ders veren + genişletilebilir HER
      //    öğretmeni sistematik test ederiz: tam-güne çıkarınca INFEASIBLE çözülüyor mu?
      //    Çözenler = tek başına yeterli darboğaz noktaları. Hiçbiri çözmüyorsa darboğaz
      //    ÇOKLU (tek öğretmenle açılamaz) — bunu açıkça söyleriz.
      const allWin: Record<string, Set<number>> = {};
      for (const c of classes) {
        const w = windowsOf(c);
        for (const [d, slots] of Object.entries(w)) {
          (allWin[d] = allWin[d] || new Set());
          for (const s of slots) allWin[d].add(s);
        }
      }
      const fullSlots: [number, number][] = [];
      for (const [d, set] of Object.entries(allWin)) for (const s of set) fullSlots.push([Number(d), s]);

      const teachesSomething = new Set<string>();
      for (const c of classes) {
        const key = colKeyOf(c), grp = groupOf(c);
        for (const course of coursesOfCol(key)) {
          if (!(((load[key as string]?.[course]) || 0) > 0)) continue;
          for (const t of teachers) {
            if ((t.branches || []).includes(course) && teacherGroups(t).includes(grp as string)) teachesSomething.add(t.id);
          }
        }
      }
      const candidates = teachers.filter(t => {
        if (!teachesSomething.has(t.id)) return false;
        return (teacherSlots[t.id] || []).length < fullSlots.length; // genişletilebilir
      });

      // Gün bazlı branş kıtlığı: her gün için, o gün ders verebilen öğretmenlerin
      // kapsadığı branşlar vs sınıfların ihtiyaç duyduğu branşlar. "Herkesin
      // Pazartesi'si var" sayısal üstünlük değil — asıl mesele ÇEŞİTLİLİK. Hem
      // kullanıcıya kök neden olarak gösterilir hem de gün-takası aramasını yönlendirir.
      const neededBranches = new Set<string>();
      for (const c of classes) {
        const key = colKeyOf(c);
        for (const course of coursesOfCol(key)) if (((load[key as string]?.[course]) || 0) > 0) neededBranches.add(course);
      }
      const dayGaps: DayGap[] = [];
      const windowDays = [...new Set(fullSlots.map(([d]) => d))].sort((a, b) => a - b);
      for (const d of windowDays) {
        const present = teachers.filter(t => (teacherSlots[t.id] || []).some(([dd]) => dd === d));
        const covered = new Set<string>();
        for (const t of present) for (const b of (t.branches || [])) covered.add(b);
        const missing = [...neededBranches].filter(b => !covered.has(b));
        if (missing.length) dayGaps.push({ day: d, missing });
      }
      // En ağır kıtlık günü önce — arama bütçesi önce oraya harcansın (darboğaz
      // büyük olasılıkla en çok branşın eksik olduğu günde).
      dayGaps.sort((a, b) => b.missing.length - a.missing.length);

      // ── Müdahaleleri GERÇEK maliyetle dene (slot sayısı ≠ maliyet) ──
      // Maliyet sırası (her kurum için genel taksonomi):
      //   0) GÜN TAKASI  — ek saat YOK, ek gün YOK; öğretmen aynı yükle farklı güne kayar.
      //   1) GÜNÜ UZAT   — +2 saat, ek gün yok ("o gün 2 saat erken gel").
      //   2) YENİ GÜN AÇ — +2 saat + yepyeni bir gün (yol, tam gün blokaj) — en pahalı.
      // Toplam solver çağrısı bütçelenir; derin analiz butonu ama sonsuz sürmesin.
      let budget = 45;
      const tryFeas = async (slotsOverride: TeacherSlots) => {
        if (budget <= 0) return false;
        budget--;
        const rt = await api<SolveResponse>('/api/program-solve', {
          method: 'POST',
          body: JSON.stringify({ ...buildPayload(slotsOverride), feasibilityTest: true }),
        });
        return !!rt.feasible;
      };

      const dayOfSlots = (slots: [number, number][]) => new Set(slots.map(([d]) => d));
      const swapFix: SwapFix[] = [];   // {teacherId,name,fromDay,toDay} — 0 ek saat
      const cheapFix: FeasFix[] = [];  // {teacherId,name,day,slots[]} — +2 saat, mevcut gün
      const costlyFix: FeasFix[] = []; // {teacherId,name,day,slots[]} — +2 saat, yeni gün

      // Ortak yardımcı: bir öğretmene belirli günlerin eksik slotlarında 2'li hizalı
      // çift ekleyerek dene; çözen ilk çifti fix listesine yaz.
      const tryPairsOn = async (t: TeacherDTO, days: number[], targetList: FeasFix[]) => {
        const cur = teacherSlots[t.id] || [];
        const curSet = new Set(cur.map(([d, s]) => `${d}:${s}`));
        const missingByDay: Record<number, number[]> = {};
        for (const [d, s] of fullSlots) {
          if (!curSet.has(`${d}:${s}`)) (missingByDay[d] = missingByDay[d] || []).push(s);
        }
        for (const d of days) {
          const sorted = [...(missingByDay[d] || [])].sort((a, b) => a - b);
          for (let i = 0; i + 1 < sorted.length; i++) {
            const pair = [sorted[i], sorted[i + 1]];
            if (pair[1] - pair[0] !== 1) continue;   // ardışık değil
            if (pair[0] % 2 !== 0) continue;         // hizasız çift — atla (1-2/3-4/5-6 çözer)
            if (await tryFeas({ ...teacherSlots, [t.id]: [...cur, [d, pair[0]], [d, pair[1]]] })) {
              targetList.push({ teacherId: t.id, name: t.name, day: d, slots: [pair[0] + 1, pair[1] + 1] });
              break; // bu öğretmen+gün için ilk çözen çift yeter
            }
          }
        }
      };

      // TUR 1 (EN UCUZ SAAT EKLEME, ÖNCE ÇALIŞIR — bütçeyi takaslar tüketmesin):
      // öğretmenin ZATEN geldiği günlerdeki eksik slotlar ("2 saat erken gel").
      for (const t of candidates) {
        const workDays = [...dayOfSlots(teacherSlots[t.id] || [])];
        await tryPairsOn(t, workDays, cheapFix);
      }

      // TUR 2 (GÜN TAKASI — 0 ek saat ama kendi alt-bütçesiyle): dayGaps pusulasıyla
      // budanır — yalnız "eksik branşı olan güne, o branşın öğretmenini taşıma"
      // takasları denenir (kombinasyon patlamasın). Öğretmenin bir çalışma günü komple
      // hedef güne taşınır (aynı slot desenleri, hedef pencereyle kesişerek).
      let swapBudget = 15;
      for (const g of dayGaps) {
        const gapWin = allWin[String(g.day)] || new Set();
        // Eksik branşlardan en çoğunu kapatan öğretmen önce denensin.
        const swapCands = candidates
          .filter(t => (t.branches || []).some(b => g.missing.includes(b)))
          .sort((a, b) =>
            (b.branches || []).filter(x => g.missing.includes(x)).length -
            (a.branches || []).filter(x => g.missing.includes(x)).length);
        for (const t of swapCands) {
          const cur = teacherSlots[t.id] || [];
          const workDays = [...dayOfSlots(cur)];
          if (!workDays.length || workDays.includes(g.day)) continue;
          for (const from of workDays) {
            if (swapBudget <= 0) break;
            swapBudget--;
            const moved = cur.filter(([d]) => d !== from)
              .concat(cur.filter(([d]) => d === from).map(([, s]) => [g.day, s] as [number, number]))
              .filter(([d, s]) => d !== g.day || gapWin.has(s));
            if (await tryFeas({ ...teacherSlots, [t.id]: moved })) {
              swapFix.push({ teacherId: t.id, name: t.name, fromDay: from, toDay: g.day });
              break; // bu öğretmen için ilk çözen takas yeter
            }
          }
          if (swapBudget <= 0 || swapFix.length >= 3) break;
        }
        if (swapBudget <= 0 || swapFix.length >= 3) break;
      }

      // TUR 3 (EN PAHALI): yeni gün açma — dayGaps pusulasıyla sıralı: önce eksik
      // branşlı günler, o günde de eksik branşı en çok kapatan öğretmen önce. Aksi
      // halde alakasız öğretmenler bütçeyi tüketip gerçek çözümlere sıra gelmiyor.
      const daysForNew = dayGaps.length ? dayGaps.map(g => g.day) : windowDays;
      for (const d of daysForNew) {
        const g = dayGaps.find(x => x.day === d);
        const newCands = candidates
          .filter(t => !dayOfSlots(teacherSlots[t.id] || []).has(d))
          .sort((a, b) => {
            const ma = g ? (a.branches || []).filter(x => g.missing.includes(x)).length : 0;
            const mb = g ? (b.branches || []).filter(x => g.missing.includes(x)).length : 0;
            return mb - ma;
          });
        for (const t of newCands) {
          await tryPairsOn(t, [d], costlyFix);
          if (costlyFix.length >= 4) break;
        }
        if (costlyFix.length >= 4) break;
      }

      setFeasResult({
        feasible: false,
        swapFix: swapFix.slice(0, 3),
        cheapFix: cheapFix.slice(0, 4),
        costlyFix: costlyFix.slice(0, 4),
        cheapest: cheapFix[0] || null,
        dayGaps,
        budgetExhausted: budget <= 0,
        multiBottleneck: swapFix.length === 0 && cheapFix.length === 0 && costlyFix.length === 0,
      });
      showToast?.(
        (swapFix.length || cheapFix.length || costlyFix.length)
          ? 'Tüm dersler yerleşemez — çözüm önerileri hazır'
          : 'Tüm dersler yerleşemez — tek bir öğretmen değişikliği YETMİYOR (birden çok darboğaz)',
        'error'
      );
    } catch (e) {
      showToast?.((e as Error).message, 'error');
    } finally {
      setFeasChecking(false);
    }
  }

  // ── Çakışma kontrolü: mevcut programları oku ve çakışanları bul ──
  async function checkConflicts() {
    if (!result?.assigned.length) return;
    const tList = teachers || []; // sonuç varken teachers her zaman yüklü
    try {
      // Mevcut programları çek
      const existing: Record<string, ProgramGrid> = {};
      await Promise.all(tList.map(async t => {
        try {
          const resp = await api<{ weekKey?: string; program?: ProgramGrid }>(`/api/program?teacherId=${t.id}`);
          existing[t.id] = resp.program || {}; // {weekKey, program} → program
        } catch { existing[t.id] = {}; }
      }));
      const items: string[] = [];
      for (const a of result.assigned) {
        const sid = slotIdFor(a.day, a.slot); if (!sid) continue;
        const prog = existing[a.teacherId] || {};
        const dayProg = prog[String(a.day)] || {};
        const cur = dayProg[sid];
        if (cur && cur.cls && cur.cls !== a.cls) {
          const tName = tList.find(t=>t.id===a.teacherId)?.name || a.teacherId;
          items.push(`${tName} — ${DAYS[a.day]} ${sid}: mevcut ${labelOf(cur.cls)} → yeni ${labelOf(a.cls)} (${a.course})`);
        }
      }
      setConflicts({ items, checked: true });
      return items.length;
    } catch(e) {
      showToast?.((e as Error).message,'error');
      return -1;
    }
  }

  // ── Mevcut programları temizle ──
  async function clearAllPrograms() {
    if (!(await confirm({ message: 'Tüm öğretmenlerin izin günleri, ders programları ve etüt rezervasyonları silinecek. Emin misiniz?', confirmLabel: 'Tümünü Sil' }))) return;
    setClearing(true);
    try {
      const res = await api<{ ok: boolean; deleted: { programs: number; slots: number; offDays: number }; teachers: number }>('/api/admin/week', { method: 'POST', body: JSON.stringify({ action: 'reset-all' }) });
      showToast?.(`Temizlendi — ${res.teachers} öğretmen, ${res.deleted.programs} program, ${res.deleted.slots} slot, ${res.deleted.offDays} izin günü`, 'success');
      // Öğretmen listesini yeniden yükle (offDays değişti)
      const data = await api<TeacherDTO[]>('/api/teachers');
      setTeachers(data);
    } catch(e) { showToast?.((e as Error).message,'error'); }
    finally { setClearing(false); }
  }

  // ── Uygula: program:{teacherId} şablonlarına yaz ──
  async function applyToTemplates(weekKey: string) {
    if (!result?.assigned.length) return;
    // Çakışma kontrolü yapılmamışsa önce kontrol et
    if (!conflicts?.checked) {
      const n = await checkConflicts();
      if (n === -1) return;
      if (n != null && n > 0) {
        showToast?.(`${n} çakışma var — kontrol edip onaylayın`,'info');
        return;
      }
    }
    setApplying(true);
    try {
      // Önce tüm öğretmenlerin programını temizle. NOT: Elle atanmış (locked) dersler de
      // silinir AMA çözücü onları pinli birim olarak assigned'a geri koyduğu için aşağıdaki
      // yazma adımında aynı slota geri gelir — hibrit akışta manuel yerleşim korunur.
      for (const t of (teachers || [])) {
        await api('/api/program', { method: 'DELETE', body: JSON.stringify({ teacherId: t.id }) });
      }
      // Yeni programı yaz
      const byTeacher: Record<string, Record<number, Record<string, { type: string; cls: string; fixed: boolean; branch: string }>>> = {};
      for (const a of result.assigned) {
        const sid = slotIdFor(a.day, a.slot); if (!sid) continue;
        byTeacher[a.teacherId] = byTeacher[a.teacherId] || {};
        byTeacher[a.teacherId][a.day] = byTeacher[a.teacherId][a.day] || {};
        const entry = {type:'ders', cls:a.cls, fixed:true, branch:a.course};
        byTeacher[a.teacherId][a.day][sid] = entry;
      }
      let ok=0;
      for (const [teacherId,program] of Object.entries(byTeacher)) {
        await api('/api/program',{method:'POST',body:JSON.stringify({teacherId,weekKey,program})});
        ok++;
      }
      showToast?.(`${ok} öğretmenin programı uygulandı`,'success');
      setConflicts(null);
    } catch(e) { showToast?.((e as Error).message,'error'); }
    finally { setApplying(false); }
  }

  // ── PDF yazdır ──
  function printSchedule(type: string, id: string) {
    setPreview(type);
    setPreviewId(id);
    setTimeout(() => window.print(), 400);
  }

  if (!teachers) return <div className="flex items-center justify-center h-48 text-gray-400">Yükleniyor...</div>;

  // Ön eşleştirme paneli aşağıda (öğretmen seçici + TeacherPresets) — teacher.presets'i düzenler.

  let totalDemand=0;
  classes.forEach(cls => {
    const key=colKeyOf(cls);
    coursesOfCol(key).forEach(course => { totalDemand+=(load[key as string]?.[course])||0; });
  });
  const capByBranch: Record<string, number> = {};
  teachers.forEach(t => {
    (t.branches||[]).forEach(b=>capByBranch[b]=(capByBranch[b]||0)+1);
  });

  return (
    <div className="space-y-5">
      {/* Aksiyonlar (başlık kaldırıldı) */}
      <div className="flex items-center justify-end flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-gray-500 flex items-center gap-1">Haftalık maks
            <input type="number" value={maxWeekly} onChange={e=>{setMaxWeekly(parseInt(e.target.value)||40); setPlanDirty(true);}}
              className="input !w-16 !py-1.5 text-center" />
          </label>
          <button onClick={clearAllPrograms} disabled={clearing}
            className="btn-ghost !px-3 !py-2 text-xs text-red-500 hover:bg-red-50 flex items-center gap-1.5 border border-red-200"
            title="Tüm öğretmenlerin mevcut programını sil">
            {clearing ? 'Siliniyor...' : 'Programları Temizle'}
          </button>
          <button onClick={feasibilityCheck} disabled={feasChecking || generating}
            className="btn-ghost !px-3 !py-2 text-xs flex items-center gap-1.5 border border-brand-soft text-brand bg-brand-soft-hover disabled:opacity-50"
            title="Tüm derslerin yerleşip yerleşemeyeceğini solver ile KESİN test et">
            <ShieldCheck size={14} /> {feasChecking ? 'Kontrol ediliyor…' : 'Kesin Kontrol'}
          </button>
          <button onClick={generate} disabled={generating}
            className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm disabled:opacity-60">
            <Sparkles size={14} /> {generating ? 'Oluşturuluyor… (~30 sn)' : 'Oluştur'}
          </button>
        </div>
      </div>

      {/* Kesin Kontrol sonucu */}
      {feasResult && (
        feasResult.feasible ? (
          <div className="card p-3 border-l-4" style={{borderLeftColor:'#16a34a', background:'#f0fdf4'}}>
            <div className="flex items-center gap-2 text-sm" style={{color:'#15803d', fontWeight:600}}>
              <ShieldCheck size={16} /> Tüm dersler yerleşebilir — program tam çözülür.
            </div>
          </div>
        ) : (
          <div className="card p-3 border-l-4" style={{borderLeftColor:'#dc2626', background:'#fef2f2'}}>
            <div className="flex items-center gap-2 text-sm mb-1.5" style={{color:'#b91c1c', fontWeight:700}}>
              <AlertTriangle size={16} /> Mevcut haliyle tüm dersler yerleşemez (geometrik olarak imkansız)
            </div>
            <p className="text-xs text-gray-600 mb-1">
              Toplam saatler yeterli olsa bile, ders bloklarının gün/saat ızgarasına çakışmadan
              dizilmesi mümkün değil.
            </p>
            {/* Gün bazlı branş kıtlığı — kök neden çoğu zaman burada.
                "Her öğretmenin Pazartesi'si var" sayısal üstünlük değil; o gün hangi
                BRANŞLARIN öğretmeni yoksa o günün slotları doldurulamaz. */}
            {feasResult.dayGaps?.length > 0 && (
              <div className="text-xs mt-1.5 mb-1.5 p-2 rounded-lg" style={{background:'#eff6ff', border:'1px solid #bfdbfe'}}>
                <div style={{color:'#1e40af', fontWeight:700}}>Gün bazlı öğretmen eksikliği (muhtemel kök neden):</div>
                <ul className="mt-1 space-y-0.5" style={{color:'#1e3a8a'}}>
                  {feasResult.dayGaps.map(g => (
                    <li key={g.day}>
                      • <b>{DAYS[g.day]}</b> günü şu branşların öğretmeni hiç müsait değil:{' '}
                      <b>{g.missing.join(', ')}</b>
                    </li>
                  ))}
                </ul>
                <p className="mt-1" style={{color:'#1e40af'}}>
                  O gün bu dersler işlenemediği için diğer günler tıkanıyor.
                </p>
              </div>
            )}

            {feasResult.multiBottleneck ? (
              <p className="text-xs text-gray-600 mt-1.5">
                <b>Birden fazla darboğaz var</b> — tek bir öğretmen değişikliği (gün takası, saat ekleme)
                yetmiyor. Şunları birlikte deneyin: ders yükünü azaltın, sınıf penceresine gün ekleyin,
                veya en dar branşlara (tek öğretmenli dersler) ikinci öğretmen ekleyin.
              </p>
            ) : (
              <>
                {/* NİTEL sunum: kategoriler EŞDEĞER çözüm sınıfları — hangisinin gerçekte
                    "ucuz" olduğunu (saat ücreti mi maaş mı, öğretmenin başka kurumdaki işi)
                    sistem bilemez, kurum bilir. Sıralama dayatılmaz; sistem yalnızca
                    gerekçeli bir öneri işaretler, karar kullanıcıda. */}
                <p className="text-xs text-gray-600 mt-1.5">
                  Aşağıdaki her seçenek <b>tek başına</b> çözer — hepsini birden yapmanız gerekmez.
                  Hangisinin kurumunuz için daha uygun olduğunu siz değerlendirin; ücretlendirme
                  biçimi ve öğretmenlerin kurum dışı taahhütleri sistemin bilemeyeceği etkenlerdir.
                </p>

                {(() => { const sg = feasSuggestion(feasResult); return sg ? (
                  <div className="text-xs mt-1.5 p-2 rounded-lg bg-brand-soft border border-brand-soft">
                    <span className="text-brand" style={{fontWeight:700}}>Sistem önerisi:</span>{' '}
                    <b className="text-brand">{sg.text}</b>
                    <span className="text-gray-500"> — {sg.why}. Bu yalnızca bir öneridir; aşağıdaki diğer seçenekler de programı çözer.</span>
                  </div>
                ) : null; })()}

                {feasResult.cheapFix.length > 0 && (
                  <div className="text-xs mt-1.5 p-2 rounded-lg border border-gray-200 bg-white">
                    <div className="text-gray-700" style={{fontWeight:700}}>Mevcut günü uzatma</div>
                    <p className="text-gray-500 mt-0.5">
                      Öğretmen o gün zaten geliyor; yalnızca erken gelir veya geç çıkar. Mevcut hiçbir
                      düzeni bozmaz; ders saati başına ücret ödeyen kurumda ek saat maliyetidir.
                    </p>
                    <ul className="mt-1 space-y-1">
                      {feasResult.cheapFix.map((s, i) => (
                        <li key={i} className="text-gray-700">
                          • <b>{s.name}</b> — {DAYS[s.day]} {s.slots.join('. ve ')}. dersi müsait işaretleyin
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {feasResult.swapFix?.length > 0 && (
                  <div className="text-xs mt-1.5 p-2 rounded-lg border border-gray-200 bg-white">
                    <div className="text-gray-700" style={{fontWeight:700}}>Gün değişikliği (takas)</div>
                    <p className="text-gray-500 mt-0.5">
                      Ek ders saati gerektirmez — toplam yük aynı kalır. Ancak öğretmenin haftalık
                      düzeni değişir ve eski gününden kapasite eksilir; öğretmenin o gün başka bir
                      kurumda işi ya da özel bir engeli varsa uygulanamaz.
                    </p>
                    <ul className="mt-1 space-y-1">
                      {feasResult.swapFix.map((s, i) => (
                        <li key={i} className="text-gray-700">
                          • <b>{s.name}</b> — <b>{DAYS[s.fromDay]}</b> yerine <b>{DAYS[s.toDay]}</b> gelsin
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {feasResult.costlyFix.length > 0 && (
                  <div className="text-xs mt-1.5 p-2 rounded-lg border border-gray-200 bg-white">
                    <div className="text-gray-700" style={{fontWeight:700}}>Yeni gün açma</div>
                    <p className="text-gray-500 mt-0.5">
                      Öğretmenin hiç gelmediği bir gün açılır — yol ve tam gün maliyetiyle en büyük
                      değişikliktir; buna karşılık kapasiteyi kalıcı olarak genişletir.
                    </p>
                    <ul className="mt-1 space-y-1">
                      {feasResult.costlyFix.map((s, i) => (
                        <li key={i} className="text-gray-700">
                          • <b>{s.name}</b> — {DAYS[s.day]} {s.slots.join('. ve ')}. ders
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="text-[11px] text-gray-400 mt-1.5">
                  Dersler 2 saatlik bloklar halinde yerleştiği için tek saat eklemek yetmez,
                  2 ardışık saat gerekir.
                  {feasResult.budgetExhausted && ' (Analiz süre sınırına ulaştı — listelenmeyen başka çözümler de olabilir.)'}
                </p>
              </>
            )}
          </div>
        )
      )}

      {/* Özet kartlar */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          {l:'Toplam talep', v:totalDemand+' saat', c:'var(--brand,#6366f1)'},
          {l:'Kadro kapasitesi', v:(teachers.length*maxWeekly)+' saat', c:totalDemand>teachers.length*maxWeekly?'#dc2626':'#16a34a'},
          {l:'Sınıf sayısı', v:classes.length, c:'#0ea5e9'},
        ].map((k,i)=>(
          <div key={i} className="card p-3.5">
            <div className="text-[11px] text-gray-400 uppercase tracking-wide">{k.l}</div>
            <div className="text-xl mt-0.5" style={{fontWeight:800,color:k.c}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Ders yükü tablosu */}
      <div className="card p-4">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h4 className="font-600 text-sm mb-1" style={{fontWeight:600}}>Haftalık Ders Yükü</h4>
            <p className="text-xs text-gray-400 mb-3">
              Üst kutuya haftalık toplam saati, alt kutuya gruplama deseni yazın — örn 7 saat için <b>3-2-2</b> veya <b>2-2-2-1</b>.
              Boş bırakılırsa 2'li gruplar kullanılır (tek kalan saat 1'lik ders olur). Her grup aynı gün içinde ardışık işlenir, farklı gruplar farklı günlere dağılır.
              Kaydet'e basarsanız plan saklanır — sekme değiştirince sıfırlanmaz.
            </p>
          </div>
          <button onClick={savePlan} disabled={savingPlan || !planDirty}
            className="btn-primary !px-3 !py-1.5 text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-50"
            title={planDirty ? 'Girilen değerleri kaydet' : 'Kaydedilmemiş değişiklik yok'}>
            <Save size={12}/> {savingPlan ? 'Kaydediliyor…' : planDirty ? 'Kaydet' : 'Kaydedildi'}
          </button>
        </div>
        <LoadTable load={load} setLoad={updateLoad} grouping={grouping} setGrouping={updateGrouping} cols={activeCols} courseMap={courseMap} />
      </div>

      {/* Sınıf bazlı günlük ders limiti (K7) — boş bırakılan gün serbesttir */}
      {/* Sınıf ders penceresi artık her sınıf kartından "Program Penceresi" ile işaretlenir
          (class.slotTemplate → KATI windows). Eski "Sınıf Bazlı Günlük Ders Limiti" kaldırıldı. */}

      {/* Ön eşleştirme (sabit dersler) — öğretmen seç → o öğretmene sınıf-ders kilitle (CP-SAT HARD preset). */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-label">Ön eşleştirme — öğretmen</label>
          <select className="input !w-auto text-sm" value={presetTeacherId}
            onChange={e => setPresetTeacherId(e.target.value)}>
            <option value="">Seç…</option>
            {[...teachers].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr'))
              .map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        {presetTeacherId ? (() => {
          const t = teachers.find(x => x.id === presetTeacherId);
          return t ? (
            <TeacherPresets
              key={`preset-${t.id}`}
              teacher={t}
              showToast={showToast}
              onSaved={(presets: TeacherPresetDTO[]) => setTeachers(prev => (prev || []).map(x => x.id === t.id ? { ...x, presets } : x))}
            />
          ) : null;
        })() : (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Bir öğretmen seçince o öğretmene sınıf-ders kilitleyebilirsiniz; program oluşturulurken çözücü
            mutlaka uyar (saati kendi seçer).
          </p>
        )}
      </div>

      {/* Ön analiz paneli */}
      {analysis && (
        <div className="card p-4 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            {analysis.ok
              ? <Check size={14} className="text-emerald-500" />
              : <AlertTriangle size={14} className="text-red-500" />}
            <span className="text-sm" style={{fontWeight:700, color: analysis.ok ? '#059669' : '#dc2626'}}>
              {analysis.ok ? 'Ön analiz tamam — oluşturabilirsiniz' : `${analysis.errors.length} hata, ${analysis.warnings.length} uyarı`}
            </span>
          </div>
          {analysis.errors.length > 0 && (
            <ul className="text-xs space-y-1">
              {analysis.errors.map((e,i) => (
                <li key={i} className="flex items-start gap-1.5 text-red-700">
                  <span className="mt-0.5 shrink-0">✕</span><span>{e}</span>
                </li>
              ))}
            </ul>
          )}
          {analysis.warnings.length > 0 && (
            <ul className="text-xs space-y-1">
              {analysis.warnings.map((w,i) => (
                <li key={i} className="flex items-start gap-1.5 text-amber-700">
                  <span className="mt-0.5 shrink-0">⚠</span><span>{w}</span>
                </li>
              ))}
            </ul>
          )}
          {analysis.infos.length > 0 && (
            <ul className="text-xs space-y-1">
              {analysis.infos.map((inf,i) => (
                <li key={i} className="flex items-start gap-1.5 text-gray-400">
                  <span className="mt-0.5 shrink-0">i</span><span>{inf}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Çakışma uyarısı */}
      {conflicts?.checked && conflicts.items.length > 0 && (
        <div className="card p-4 border-amber-200 bg-amber-50">
          <div className="flex items-start gap-2 mb-2">
            <AlertTriangle size={15} className="text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-amber-700" style={{fontWeight:700}}>Mevcut programla {conflicts.items.length} çakışma var</p>
              <p className="text-xs text-amber-600 mt-0.5">Uygulamak bu slotların üzerine yazacak. Devam etmek istiyor musunuz?</p>
            </div>
          </div>
          <ul className="text-xs text-gray-600 mb-3 space-y-0.5 pl-5 list-disc">
            {conflicts.items.slice(0,10).map((item,i)=><li key={i}>{item}</li>)}
            {conflicts.items.length>10 && <li className="text-gray-400">...ve {conflicts.items.length-10} tane daha</li>}
          </ul>
          <div className="flex gap-2">
            <button onClick={() => applyToTemplates(currentWeekKey())} disabled={applying}
              className="btn-primary !px-3 !py-1.5 text-xs flex items-center gap-1.5">
              {applying ? 'Uygulanıyor...' : <><Check size={12}/> Yine de Uygula</>}
            </button>
            <button onClick={() => setConflicts(null)} className="btn-ghost !px-3 !py-1.5 text-xs">İptal</button>
          </div>
        </div>
      )}

      {/* Sonuç */}
      {result && (
        <ResultView
          result={result} classes={classes} teachers={teachers} labelOf={labelOf}
          maxWeekly={maxWeekly} applying={applying}
          conflictsChecked={!!(conflicts?.checked && conflicts.items.length === 0)}
          onApply={() => applyToTemplates(currentWeekKey())}
          onCheckConflicts={checkConflicts}
          onPrintTeacher={id => printSchedule('teacher',id)}
          onPrintClass={cls => printSchedule('class',cls)}
          windowsOf={windowsOf} teacherSlots={lastTeacherSlots} groupOf={groupOf}
          onEdit={patch => {
            // Manuel düzenleme (taşıma/takas/yerleştirme/açığa alma): sonuç değişti →
            // total yeniden sayılır, çakışma onayı bayatladı → Uygula öncesi yeniden
            // kontrol zorunlu (Uygula akışı zaten checked ister).
            setResult(r => {
              const next = { ...(r as SolveResult), ...patch };
              next.total = next.assigned.length;
              return next;
            });
            setConflicts(null);
          }}
        />
      )}

      {/* Yazdırma önizleme (ekranda gizli, sadece print'te görünür) */}
      {preview && result && (
        <PrintPreview
          type={preview} id={previewId}
          result={result} teachers={teachers} classes={classes} labelOf={labelOf}
          brandName={branding?.name}
          onClose={()=>setPreview(null)}
        />
      )}
    </div>
  );
}
