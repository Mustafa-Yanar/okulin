// İstemci hafta gezinmesi (haftalık program ◀ ▶). e2e/helpers.js shiftWeek ile aynı ISO
// mantık; sunucu ?week= param'ını doğrular, geçersizse bu haftaya düşer (savunma sunucuda).
function getMondayOfWeek(weekKey: string): Date {
  const [year, wStr] = weekKey.split('-W');
  const week = parseInt(wStr, 10);
  const jan4 = new Date(parseInt(year, 10), 0, 4);
  const dow = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dow + 1 + (week - 1) * 7);
  return monday;
}
function weekKeyOf(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}
export function shiftWeekKey(weekKey: string, delta: number): string {
  const mon = getMondayOfWeek(weekKey);
  mon.setDate(mon.getDate() + delta * 7);
  return weekKeyOf(mon);
}
