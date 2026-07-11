import type { TeacherDTO } from '../types';

// ── Program oluşturucu tip sözlüğü ──
// colKeyOf/groupOf eşleşmeyen özel şubede (s_…) null döndürür; null anahtarla
// load/grouping erişimi çalışma anında zararsızdır (undefined döner, boş kurs
// listesiyle döngüler hiç koşmaz). Bu bilinçli durumlar ilgili yerlerde tekil tip
// iddialarıyla (as string / !) işaretlendi — davranış birebir JS ile aynı.
export type ApiFn = <T = unknown>(path: string, opts?: RequestInit) => Promise<T>;
export type Load = Record<string, Record<string, number>>;          // colKey → ders → saat
export type Grouping = Record<string, Record<string, string>>;      // colKey → ders → "3-2-2"
export type Windows = Record<number, number[]>;                     // gün → [slotIdx]
export type TeacherSlots = Record<string, [number, number][]>;      // teacherId → [gün, slotIdx][]

// Solver çıktısı satırı (assigned) — /api/program-solve sözleşmesi.
export interface Assigned {
  cls: string;
  course: string;
  teacherId: string;
  teacherName: string;
  day: number;
  slot: number;
}
export interface Unplaced {
  cls: string;
  course: string;
  hours?: number;
  reason: string;
}
export interface SolveResult {
  assigned: Assigned[];
  unplaced: Unplaced[];
  tLoad: Record<string, number>;
  total: number;
  ms: number;
}
export interface SolveResponse {
  assigned?: Assigned[];
  unplaced?: Unplaced[];
  tLoad?: Record<string, number>;
  ms?: number;
  presetWarnings?: string[];
  feasible?: boolean;
}

// /api/program yanıtındaki ızgara: gün → slotId → hücre.
export interface ProgramCell { type?: string; cls?: string; branch?: string; fixed?: boolean }
export type ProgramGrid = Record<string, Record<string, ProgramCell>>;

// Manuel düzenleme bloğu (aynı gün+sınıf+ders+öğretmen ardışık koşusu).
export interface Block {
  id: string;
  day: number;
  start: number;
  len: number;
  cls: string;
  course: string;
  teacherId: string;
}

export interface FeasFix { teacherId: string; name: string; day: number; slots: number[] }
export interface SwapFix { teacherId: string; name: string; fromDay: number; toDay: number }
export interface DayGap { day: number; missing: string[] }
export interface FeasInfeasible {
  feasible: false;
  swapFix: SwapFix[];
  cheapFix: FeasFix[];
  costlyFix: FeasFix[];
  cheapest: FeasFix | null;
  dayGaps: DayGap[];
  budgetExhausted: boolean;
  multiBottleneck: boolean;
}
export type FeasResult = { feasible: true; suggestions: never[] } | FeasInfeasible;

export interface AnalyzeCtx {
  colKeyOf: (cls: string) => string | null;
  groupOf: (cls: string) => string | null;
  labelOf: (cls: string) => string;
  windowsOf: (cls: string) => Windows;
  teacherSlots?: TeacherSlots | null;
  coursesForCol?: (key: string | null) => string[];
}

export interface SolvePayload {
  classes: string[];
  teachers: TeacherDTO[];
  load: Load;
  pieces: Record<string, Record<string, number[]>>;
  maxWeekly: number;
  windows: Record<string, Windows>;
  colKey: Record<string, string | null>;
  group: Record<string, string | null>;
  teacherSlots: TeacherSlots;
  presets: { teacherId: string; cls: string; course: string }[];
  feasibilityTest?: boolean;
}
