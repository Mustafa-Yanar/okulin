// İstemci tarafı ortak DTO tipleri — TEK kaynak (TS Faz 3).
// API route'larının döndürdüğü JSON şekilleri; sunucudaki mapper'larla
// (ör. app/api/students/route.ts studentOut, app/api/teachers/route.ts GET)
// birebir eşleşir. lib/'de zaten var olan tipler BURAYA kopyalanmaz —
// Session (lib/auth), Branding (lib/branding), ConfigValue (lib/config),
// Slot/SlotTime (lib/constants), SlotCell/ProgramEntry (lib/slots),
// ClassRecord (lib/classes), CourseRecord (lib/courses) doğrudan import edilir.
// NOT: import type satırları derlemede silinir; sunucu modüllerinden tip almak
// client bileşenlerde güvenlidir.

import type { ReactNode } from 'react';
import type { Session } from '@/lib/auth';
import type { Branding } from '@/lib/branding';
import type { ConfigValue } from '@/lib/config';
import type { PaymentEntry } from '@/lib/finance';
import type { SlotCell } from '@/lib/slots';

// AppContent.showToast imzası — tüm panellere prop olarak iner.
// msg ReactNode: Toast bileşeni düğüm render eder (çoğu çağrı düz string geçer).
export type ShowToast = (msg: ReactNode, type?: string) => void;

// GET /api/students — studentOut mapper çıktısı.
export interface StudentDTO {
  id: string;
  name: string;
  username: string;
  cls: string;
  group: string;
  phone: string;
  parentPhone: string;
  parentName: string;
  birthDate: string;
  diplomaNotu: number | '';
  obp: number | null;
  parentRelation: string;
  parentNote: string;
  parent2Name: string;
  parent2Phone: string;
  parent2Relation: string;
  tcNo: string;          // öğrenci TC (muhasebe belgeleri)
  parentTcNo: string;    // veli TC (senet)
  parentAddress: string; // veli adresi (senet)
}

// Öğretmen ders ön-tanımı (preset): sınıf + ders eşlemesi.
export interface TeacherPresetDTO {
  cls: string;
  course: string;
}

// GET /api/teachers — liste elemanı.
export interface TeacherDTO {
  id: string;
  name: string;
  username: string;
  branches: string[];
  allowedGroups: string[];
  photoUrl: string;
  offDays: number[]; // gün indeksi 0-6 (Prisma: Int[]) — string değil
  phone: string;
  presets: TeacherPresetDTO[];
}

// Ön kayıt (CRM) adayı — app/api/onkayit/route.ts LeadData ile birebir.
export interface LeadDTO {
  id: string;
  studentName: string;
  parentName?: string;
  phone?: string;
  level?: string;
  source?: string;
  status: string;
  history?: { at: string; byName: string; text: string }[];
  createdBy?: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

// GET /api/finance — financeOut mapper çıktısı (app/api/finance/route.ts).
export interface InstallmentDTO {
  idx: number;
  dueDate: string;
  amount: number;
  paid: boolean;
  paidDate: string | null;
  paidAmount: number | null;
  method: string | null;
  receiptNo: string | null;
}
export interface FinanceDTO {
  studentId?: string;
  studentName?: string;
  studentCls: string;
  registrationDate: string;
  totalFee: number;
  discount: number;
  netFee: number;
  paymentPlan: string;
  installments: InstallmentDTO[];
  payments: PaymentEntry[];
  balance: number;
}
// GET /api/finance liste elemanı (öğrenci + finans kaydı; kayıtsızsa finance null).
export interface FinanceListItemDTO {
  studentId: string;
  studentName: string;
  studentCls: string;
  studentTc?: string;      // muhasebe belgeleri (senet/makbuz)
  parentName?: string;
  parentPhone?: string;
  parentTcNo?: string;
  parentAddress?: string;
  className?: string;      // sınıf adı (ör. "7/701")
  finance: FinanceDTO | null;
}

// Muhasebe belgelerinde (senet/makbuz/ekstre) kurumun kimlik bilgisi.
// branding'ten (ad/logo) + TenantConfig legal'den (resmi ünvan/vergi/adres) birleşir.
export interface KurumBilgi {
  name: string;            // marka adı (Org.name)
  logoUrl: string;         // Org.logoUrl (boşsa bileşen varsayılan gösterir)
  officialName: string;    // resmi ünvan (…Ltd. Şti.)
  taxOffice: string;
  taxNo: string;
  officialAddress: string;
}

// GET /api/slots düz satırı — öğretmen+gün+slot bilgisi + hücre durumu
// (app/api/slots/route.ts GET mapper'ı ile birebir). Panellerin allSlots dizisi.
export type SlotEntryDTO = {
  teacherId: string;
  teacherName: string;
  branches: string[];
  allowedGroups: string[];
  day: number;
  dayLabel: string;
  weekend: boolean;
  slotId: string;
  slotLabel: string;
} & SlotCell;

// GET /api/auth — oturum + kurum durumu (whoami).
export interface WhoamiResponse {
  session: Session | null;
  directorExists: boolean;
  branding: Branding;
  modules: ConfigValue<'modules'>;
  etut: ConfigValue<'etut'>;
  permissions: ConfigValue<'permissions'>;
}
