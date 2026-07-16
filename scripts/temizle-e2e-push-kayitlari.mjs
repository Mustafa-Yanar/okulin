// Tek seferlik: e2e testlerinin bıraktığı çöp push kayıtlarını temizler.
// Çalıştırma: node --env-file=.env.local scripts/temizle-e2e-push-kayitlari.mjs
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const r = await prisma.deviceInstallation.deleteMany({ where: { token: { startsWith: 'e2e-fcm-' } } });
console.log(`silinen yetim DeviceInstallation: ${r.count}`);
await prisma.$disconnect();
