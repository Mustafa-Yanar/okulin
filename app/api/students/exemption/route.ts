import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zId } from '@/lib/validate';
import { setStudentExemption } from '@/lib/students';

// Yoklama muafiyeti (izinli/raporlu) aralığı — yalnız müdür + rehberlik yönetir.
// Genel öğrenci PUT'una ('intake': muhasebeci de girebilir) bilinçli KONMADI:
// muafiyet bir yoklama/rehberlik kararıdır, kayıt akışının parçası değil.
const ExemptionSchema = z.object({
  id: zId,
  exemptFrom: z.string().max(20).optional(),  // YYYY-MM-DD; ikisi de boş → muafiyet kaldırılır
  exemptUntil: z.string().max(20).optional(),
  exemptNote: z.string().max(300).optional(),
});

export const POST = withAuth(['director', 'counselor'], async (req, _ctx, session) => {
  const parsed = await parseBody(req, ExemptionSchema);
  if (!parsed.ok) return parsed.response;
  const { id, exemptFrom, exemptUntil, exemptNote } = parsed.data;

  const result = await setStudentExemption(id, exemptFrom, exemptUntil, exemptNote);
  await logAudit({
    ...actorFrom(session),
    action: 'student.exemption',
    target: { type: 'student', id, name: result.name },
    detail: result.cleared
      ? `Yoklama muafiyeti kaldırıldı: ${result.name}`
      : `Yoklama muafiyeti tanımlandı: ${result.name} (${exemptFrom} → ${exemptUntil})${exemptNote ? ` — ${exemptNote}` : ''}${result.cleanedEntries ? ` — aralıktaki ${result.cleanedEntries} mevcut yoklama girişi temizlendi` : ''}`,
  });
  return NextResponse.json({ ok: true, cleanedEntries: result.cleanedEntries });
});
