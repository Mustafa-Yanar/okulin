import redis from '@/lib/db';
import { sendPushToUser } from '@/lib/push';
import { isSqlEnabled } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';

// "Bir kez bildir" idempotency. SQL: NotifLog'a create dener; @@unique çakışması
// (P2002) → zaten bildirilmiş, false döner. Redis: NX kilit (göç sonrası ölecek).
// kind: 'att' | 'deneme'. dedupeKey: benzersiz bildirim anahtarı. ttlSec: Redis TTL.
// İlk kez ise true (push gönder), tekrar ise false (atla).
async function claimNotif(kind, dedupeKey, ttlSec) {
  if (isSqlEnabled()) {
    try {
      await tdb().notifLog.create({ data: { kind, dedupeKey } });
      return true;
    } catch (e) {
      if (e?.code === 'P2002') return false; // zaten bildirilmiş
      throw e;
    }
  }
  const ok = await redis.set(`${kind}_notif:${dedupeKey}`, 1, { nx: true, ex: ttlSec });
  return !!ok;
}

// Veli push tetikleyicileri (agresif bildirim — SMS yerine ücretsiz anlık push).
// Her fonksiyon BEST-EFFORT: asla hata fırlatmaz, çağıran akışı (yoklama kaydı / hesaplama)
// bozmaz. "Bir kez bildir" NX kilidiyle tekrar push (yoklama düzeltme, yeniden hesaplama) önlenir.
// Veli kimliği TELEFON-bazlı (parentPhone); kardeşler tek push'ta birleşir.

// Yoklamada "yok" işaretlenen öğrencilerin velilerine "derse gelmedi" push'u.
// Kilit: att_notif:<date>:<studentId> (TTL 18s) → günde bir kez/öğrenci, düzeltmede tekrar etmez.
export async function notifyAbsentParents(date, attendance) {
  try {
    const absentIds = Object.entries(attendance || {})
      .filter(([, v]) => v === 'yok')
      .map(([id]) => id);
    if (absentIds.length === 0) return;

    // "Bir kez" kilidi — bugün bu öğrenci için zaten bildirildiyse atla
    const fresh = [];
    for (const sid of absentIds) {
      const ok = await claimNotif('att', `${date}:${sid}`, 64800); // 18 saat (Redis TTL)
      if (ok) fresh.push(sid);
    }
    if (fresh.length === 0) return;

    // Öğrenci kayıtları → parentPhone + ad (SQL-aware; att_notif kilidi Redis kalır)
    const byParent = {}; // phone -> [ad]
    if (isSqlEnabled()) {
      const studs = await tdb().student.findMany({ where: { legacyId: { in: fresh } }, select: { parentPhone: true, name: true } });
      studs.forEach((s) => { if (s.parentPhone) (byParent[s.parentPhone] ||= []).push(s.name || 'Öğrenciniz'); });
    } else {
      const pipe = redis.pipeline();
      fresh.forEach((id) => pipe.get(`student:${id}`));
      const recs = await pipe.exec();
      recs.forEach((s) => { if (s && s.parentPhone) (byParent[s.parentPhone] ||= []).push(s.name || 'Öğrenciniz'); });
    }

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

// Deneme hesaplanınca eşleşmiş öğrencilerin velilerine "yeni sonuç" push'u.
// Kilit: deneme_notif:<examId>:<phone> (TTL 45 gün) → yeniden hesaplama spam yapmaz;
// sonradan eşleşen yeni öğrencinin velisi de ilk kez bildirilir.
export async function notifyExamResults(exam) {
  try {
    const rows = Array.isArray(exam?.rows) ? exam.rows : [];
    const sids = [...new Set(rows.map((r) => r.studentId).filter(Boolean))];
    if (sids.length === 0) return;

    const phones = new Set();
    if (isSqlEnabled()) {
      const studs = await tdb().student.findMany({ where: { legacyId: { in: sids } }, select: { parentPhone: true } });
      studs.forEach((s) => { if (s.parentPhone) phones.add(s.parentPhone); });
    } else {
      const pipe = redis.pipeline();
      sids.forEach((id) => pipe.get(`student:${id}`));
      const recs = await pipe.exec();
      recs.forEach((s) => { if (s && s.parentPhone) phones.add(s.parentPhone); });
    }

    for (const phone of phones) {
      const ok = await claimNotif('deneme', `${exam.id}:${phone}`, 3888000); // 45 gün (Redis TTL)
      if (!ok) continue; // bu veli bu sınav için zaten bildirildi
      await sendPushToUser('parent', phone, {
        title: 'Yeni Deneme Sonucu',
        body: `${exam.name} sonuçları açıklandı. Detay için panele girin.`,
        url: '/?sekme=rehberlik',
        tag: `deneme-${exam.id}`,
      });
    }
  } catch {
    /* bildirim tetikleyici çağıran akışı asla bozmaz */
  }
}
