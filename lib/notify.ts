import { sendPushToUser } from '@/lib/push';
import { tdb, withScope } from '@/lib/sqldb';

// "Bir kez bildir" idempotency. NotifLog'a create dener; @@unique çakışması
// (P2002) → zaten bildirilmiş, false döner.
// kind: 'att' | 'deneme'. dedupeKey: benzersiz bildirim anahtarı.
// İlk kez ise true (push gönder), tekrar ise false (atla).
async function claimNotif(kind: string, dedupeKey: string): Promise<boolean> {
  try {
    await tdb().notifLog.create({ data: withScope({ kind, dedupeKey }) });
    return true;
  } catch (e) {
    if ((e as { code?: string } | null)?.code === 'P2002') return false; // zaten bildirilmiş
    throw e;
  }
}

// Veli push tetikleyicileri (agresif bildirim — SMS yerine ücretsiz anlık push).
// Her fonksiyon BEST-EFFORT: asla hata fırlatmaz, çağıran akışı (yoklama kaydı / hesaplama)
// bozmaz. "Bir kez bildir" NX kilidiyle tekrar push (yoklama düzeltme, yeniden hesaplama) önlenir.
// Veli kimliği TELEFON-bazlı (parentPhone); kardeşler tek push'ta birleşir.

// Yoklamada "yok" işaretlenen öğrencilerin velilerine "derse gelmedi" push'u.
// Kilit: att_notif:<date>:<studentId> (TTL 18s) → günde bir kez/öğrenci, düzeltmede tekrar etmez.
export async function notifyAbsentParents(date: string, attendance: Record<string, string> | null | undefined): Promise<void> {
  try {
    const absentIds = Object.entries(attendance || {})
      .filter(([, v]) => v === 'yok')
      .map(([id]) => id);
    if (absentIds.length === 0) return;

    // "Bir kez" kilidi — bugün bu öğrenci için zaten bildirildiyse atla
    const fresh: string[] = [];
    for (const sid of absentIds) {
      const ok = await claimNotif('att', `${date}:${sid}`);
      if (ok) fresh.push(sid);
    }
    if (fresh.length === 0) return;

    // Öğrenci kayıtları → parentPhone + ad
    const byParent: Record<string, string[]> = {}; // phone -> [ad]
    const studs = await tdb().student.findMany({ where: { legacyId: { in: fresh } }, select: { parentPhone: true, name: true } });
    studs.forEach((s) => { if (s.parentPhone) (byParent[s.parentPhone] ||= []).push(s.name || 'Öğrenciniz'); });

    for (const [phone, names] of Object.entries(byParent)) {
      await sendPushToUser('parent', phone, {
        title: 'Devamsızlık Bildirimi',
        body: `${names.join(', ')} bugün derse katılmadı.`,
        url: '/?sekme=program',
        tag: `devamsizlik-${date}`,
      });
    }
  } catch {
    /* bildirim tetikleyici çağıran akışı asla bozmaz */
  }
}

// Yeni cihazda başarılı OTP doğrulaması + cihaz kaydı sonrası hesabın MEVCUT (önceden
// abone) cihazlarına "yeni cihaz girişi" güvenlik push'u. Yeni cihaz henüz abone
// değildir → bildirim eski cihazlara ulaşır: "bu siz değilseniz şifrenizi değiştirin".
// BEST-EFFORT: asla hata fırlatmaz, login akışını bozmaz. Dedupe YOK — her yeni cihaz
// tanıma olayı bir güvenlik uyarısıdır, bastırılmaz. role/userId push aboneliğinin
// anahtarıdır (session.role, session.id ile birebir; bkz. otp/verify getOtpIdentity).
export async function notifyNewDeviceLogin(role: string, userId: string, when?: Date): Promise<void> {
  try {
    if (!role || !userId) return;
    const time = (when || new Date()).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    await sendPushToUser(role, userId, {
      title: 'Yeni cihaz girişi',
      body: `Hesabınıza yeni bir cihazdan giriş yapıldı (${time}). Bu siz değilseniz hemen şifrenizi değiştirin.`,
      url: '/',
      tag: 'yeni-cihaz',
      requireInteraction: true,
    });
  } catch {
    /* güvenlik bildirimi login akışını asla bozmaz */
  }
}

// Deneme hesaplanınca eşleşmiş öğrencilerin velilerine "yeni sonuç" push'u.
// Kilit: deneme_notif:<examId>:<phone> (TTL 45 gün) → yeniden hesaplama spam yapmaz;
// sonradan eşleşen yeni öğrencinin velisi de ilk kez bildirilir.
export async function notifyExamResults(exam: { id: string; name?: string; rows?: { studentId?: string | null }[] } | null | undefined): Promise<void> {
  try {
    const rows = Array.isArray(exam?.rows) ? exam.rows : [];
    const sids = [...new Set(rows.map((r) => r.studentId).filter((v): v is string => Boolean(v)))];
    if (sids.length === 0) return;

    const phones = new Set<string>();
    const studs = await tdb().student.findMany({ where: { legacyId: { in: sids } }, select: { parentPhone: true } });
    studs.forEach((s) => { if (s.parentPhone) phones.add(s.parentPhone); });

    for (const phone of phones) {
      const ok = await claimNotif('deneme', `${exam!.id}:${phone}`);
      if (!ok) continue; // bu veli bu sınav için zaten bildirildi
      await sendPushToUser('parent', phone, {
        title: 'Yeni Deneme Sonucu',
        body: `${exam!.name} sonuçları açıklandı. Detay için panele girin.`,
        url: '/?sekme=rehberlik',
        tag: `deneme-${exam!.id}`,
      });
    }
  } catch {
    /* bildirim tetikleyici çağıran akışı asla bozmaz */
  }
}
