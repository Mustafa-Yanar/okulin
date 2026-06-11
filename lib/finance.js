// Ortak finans yardımcıları. Taksit kredilendirme mantığı TEK yerde — hem manuel
// ödeme route'u (app/api/finance/payment) hem online ödeme callback'i (PayTR)
// buradan geçer → mantık çatallanmaz (çift kredilendirme/makbuz hataları önlenir).
//
// redis: çağıranın scope'lu client'ı (@/lib/db veya tenantRedis(org, branch)).
//        Online callback, org bağlamı header'dan gelmediği için EXPLICIT scope geçer.

// Makbuz numarası: MKB-YYYY-00001 (receipt_counter scope'lu sayaç).
export async function generateReceiptNo(redis) {
  const year = new Date().getFullYear();
  const count = await redis.incr('receipt_counter');
  return `MKB-${year}-${String(count).padStart(5, '0')}`;
}

// Bir öğrencinin finans kaydına ödeme uygula.
//
// opts:
//   studentId        (zorunlu)
//   amount           (genel ödemede tutar; explicit taksitte yok sayılır)
//   installmentIdx   (açık taksit seçimi; null/undefined → ilk ödenmemiş)
//   method           ('Nakit' | 'PayTR' | ...)
//   note, date, recordedBy
//
// Döner: { ok:true, record, payment, balance, receiptNo } | { ok:false, error, status }
export async function applyInstallmentPayment(redis, opts) {
  const { studentId, amount, installmentIdx, method, note, date, recordedBy } = opts;

  const record = await redis.get(`finance:${studentId}`);
  if (!record) return { ok: false, error: 'Finansal kayıt bulunamadı', status: 404 };

  const installments = [...(record.installments || [])];

  // Hedef taksit: açıkça seçilen ya da (genel ödemede) ilk ödenmemiş.
  const explicit = installmentIdx !== null && installmentIdx !== undefined && installmentIdx >= 0;
  let targetIdx = explicit ? installmentIdx : null;
  if (!explicit && installments.length > 0) {
    targetIdx = installments.findIndex(inst => !inst.paid);
  }
  const targetInst = (targetIdx !== null && targetIdx >= 0) ? installments[targetIdx] : null;

  // Ödenmiş taksite ikinci tahsilat YOK (manuel çift tıklama / eşzamanlı kayıt).
  // Online akışta start route'u aynı kontrolü sipariş ÖNCESİ yapar; bu satır son siper.
  if (explicit && targetInst?.paid) {
    return { ok: false, error: 'Bu taksit zaten ödenmiş', status: 400 };
  }

  // Açık taksitte HER ZAMAN taksitin tamamı; genel ödemede girilen tutar.
  const payAmount = (explicit && targetInst) ? (parseFloat(targetInst.amount) || 0) : parseFloat(amount);
  if (!payAmount || payAmount <= 0) return { ok: false, error: 'Geçersiz ödeme tutarı', status: 400 };

  const receiptNo = await generateReceiptNo(redis);
  const paymentDate = date || new Date().toISOString().slice(0, 10);

  const payment = {
    id: Math.random().toString(36).slice(2, 10),
    date: paymentDate,
    amount: payAmount,
    method: method || 'Nakit',
    note: note || '',
    receiptNo,
    recordedBy: recordedBy || '',
  };

  const payments = [...(record.payments || []), payment];
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const balance = record.netFee - totalPaid;

  // Taksiti "ödendi": açık seçimde her zaman; genel ödemede yalnız tam karşılanıyorsa.
  if (targetInst) {
    const due = parseFloat(targetInst.amount) || 0;
    if (explicit || due <= 0 || payAmount + 0.01 >= due) {
      installments[targetIdx] = {
        ...targetInst,
        paid: true,
        paidDate: paymentDate,
        paidAmount: payAmount,
        method: method || 'Nakit',
        receiptNo,
      };
    }
  }

  const updated = { ...record, payments, installments, balance };
  await redis.set(`finance:${studentId}`, updated);

  return { ok: true, record: updated, payment, balance, receiptNo };
}
