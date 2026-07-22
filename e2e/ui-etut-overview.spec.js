/**
 * GERÇEK UI — Müdür/rehber toplu etüt görünümü (salt-okunur)
 * Sidebar "Etütler" sekmesi (?sekme=etutler) → EtutOverviewTab: haftanın tüm
 * etütleri öğretmen-bazlı listelenir; "Öğrenciye göre" görünümü de açılır.
 * Veriye bağımlı iddia YOK: kart listesi veya boş-durum metni ikisi de geçerli
 * (canlı testkurs'ta o haftanın etüt tanımına bağlı) — kablolamayı ve iki
 * görünümün render'ını mühürler.
 */
const { test, expect } = require('@playwright/test');
const { BASE, DIR_STATE } = require('./helpers');

test('müdür: Etütler sekmesi açılır, iki gruplama görünümü de render olur', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: DIR_STATE, baseURL: BASE });
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/?sekme=etutler`);

    // Sekme yüklendi: gruplama düğmeleri göründü (bileşen mount kanıtı)
    const teacherBtn = page.getByRole('button', { name: 'Öğretmene göre' });
    const studentBtn = page.getByRole('button', { name: 'Öğrenciye göre' });
    await expect(teacherBtn).toBeVisible();
    await expect(studentBtn).toBeVisible();

    // Öğretmen görünümü: özet satırı ("N etüt · ...") YA DA boş-durum başlığı
    const summaryOrEmpty = page
      .getByText(/\d+ etüt · \d+ dolu/)
      .or(page.getByText('Bu hafta tanımlı etüt yok'));
    await expect(summaryOrEmpty.first()).toBeVisible({ timeout: 15_000 });

    // Öğrenci görünümüne geç: kart(lar) YA DA "atanmış etüt yok" boş-durumu
    await studentBtn.click();
    const studentViewProof = page
      .getByText('Bu hafta atanmış etüt yok')
      .or(page.getByText(/\d+ etüt/).first());
    await expect(studentViewProof.first()).toBeVisible({ timeout: 15_000 });
  } finally {
    await ctx.close();
  }
});
