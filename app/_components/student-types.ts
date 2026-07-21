// Öğrenci paneli ortak tipleri — StudentPanel, AvailableTree, StudentBookingsView
// ve dış tüketiciler (ParentPanel, director/StudentList, SinifOgrenci) paylaşır.

// Etüt şablonundan türetilen slot-benzeri satır — AvailableTree/StudentBookingsView
// ortak şekli (ParentPanel /api/slots satırlarını da bu şekle karıştırır).
export interface BookingSlotEntry {
  kind?: string;
  etutId?: string;
  teacherId: string;
  teacherName?: string;
  branches?: string[];
  allowedGroups?: string[];
  day: number;
  dayLabel?: string;
  start?: string;
  end?: string;
  slotId: string;
  slotLabel: string;
  booked?: boolean;
  disabled?: boolean;
  fixed?: boolean;
  studentId?: string | null;
  studentName?: string | null;
  branch?: string;
  bookedBy?: string | null;
  scope?: string | null;
}

// GET /api/etut-sablon/all etüt satırı.
export interface EtutAllDTO {
  id: string;
  teacherId: string;
  teacherName?: string;
  branches?: string[];
  allowedGroups?: string[];
  dayIndex: number;
  dayLabel?: string;
  start: string;
  end: string;
  booked?: boolean;
  studentId?: string | null;
  studentName?: string | null;
  studentCls?: string | null;
  branch?: string;
  bookedBy?: string;
  scope?: 'WEEK' | 'RECURRING' | null;
}

// Rezervasyon/iptal argümanları (AvailableTree onBook / BookingsView onCancel).
export interface BookEtutArgs {
  teacherId: string;
  day: number;
  slotId: string;
  branch: string;
  kind?: string;
  etutId?: string;
}
export interface BookingCancelArgs {
  teacherId: string;
  day: number;
  slotId: string;
  kind?: string;
  etutId?: string;
}
