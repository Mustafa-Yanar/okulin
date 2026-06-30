// Kimlik üreteci — TEK kaynak. Eskiden 25 dosyada `Math.random().toString(36)`
// kopyası vardı (kriptografik değil, çakışma + tahmin riski). Hepsi buradan geçer.
//
// crypto.randomUUID() Node 18+ ve modern tarayıcılarda global — ekstra import yok.

// Saf benzersiz id. opts.prefix verilirse başına eklenir (örn 's_' sınıf, 'et' etüt).
export function newId(prefix = '') {
  return prefix + crypto.randomUUID();
}

// Kabaca kronolojik sıralanabilir id: zaman damgası (base36) + uuid. Listeleme
// sırasının kabaca oluşturulma sırasını yansıtması istenen yerler için (deneme/satır).
export function newSortableId(prefix = '') {
  return prefix + Date.now().toString(36) + '-' + crypto.randomUUID();
}

export default newId;
