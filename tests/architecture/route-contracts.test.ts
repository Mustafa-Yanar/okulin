import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

type Handler = { method: string; route: string; source: string; file: string; guard: string };

const API_ROOT = path.join(process.cwd(), 'app', 'api');

function routeFiles(dir = API_ROOT): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === 'route.ts' ? [full] : [];
  });
}

function routeOf(file: string): string {
  return '/' + path.relative(path.join(process.cwd(), 'app'), path.dirname(file))
    .split(path.sep).map((part) => part.replace(/^\[([^\]]+)\]$/, ':$1')).join('/');
}

function guardOf(source: string): string {
  if (/\bwithAuth\s*\(/.test(source)) return 'withAuth';
  if (/\bwithMobileAuth\s*\(/.test(source)) return 'withMobileAuth';
  return 'custom/public';
}

function handlers(): Handler[] {
  const out: Handler[] = [];
  for (const file of routeFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const statement of sf.statements) {
      const isExported = ts.canHaveModifiers(statement)
        && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      if (!isExported) continue;
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const method = declaration.name.getText(sf);
          if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(method) || !declaration.initializer) continue;
          const source = declaration.initializer.getText(sf);
          out.push({ method, route: routeOf(file), source, file, guard: guardOf(source) });
        }
      } else if (ts.isFunctionDeclaration(statement)) {
        const method = statement.name?.getText(sf) || '';
        if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(method)) continue;
        const source = statement.getText(sf);
        out.push({ method, route: routeOf(file), source, file, guard: guardOf(source) });
      }
    }
  }
  return out;
}

const CUSTOM_HANDLER_ALLOWLIST: Record<string, string> = {
  'GET /api/backup': 'CRON_SECRET ile sunucu-sunucu yedekleme',
  'GET /api/cron/cleanup': 'CRON_SECRET ile bakım',
  'GET /api/cron/notif-dispatch': 'CRON_SECRET ile bildirim kuyruğu',
  'GET /api/cron/payment-reminders': 'CRON_SECRET ile ödeme hatırlatma',
  'GET /api/cron/weekly': 'CRON_SECRET ile hafta devri',
  'GET /api/auth': 'oturumun kendisini okur',
  'POST /api/auth': 'oturumu burada kurar',
  'POST /api/demo-request': 'herkese açık iletişim formu',
  'POST /api/gate': 'herkese açık kurum kodu kapısı',
  'POST /api/log': 'giriş öncesi hataları da kabul eder, rate-limitli',
  'GET /api/manifest': 'herkese açık PWA manifesti',
  'POST /api/mobile/v1/auth/login': 'mobil oturumu burada kurar',
  'POST /api/mobile/v1/auth/refresh': 'access token süresi dolduğunda çağrılır',
  'GET /api/mobile/v1/bootstrap': 'giriş öncesi sürüm ve bakım kapısı',
  'POST /api/mobile/v1/resolve-org': 'giriş öncesi kurum keşfi',
  'GET /api/mobile/v1/session-open': 'tek kullanımlık kodla web oturumu kurar',
  'GET /api/org': 'login ekranı kurum markasını okur',
  'POST /api/otp/verify': 'OTP ile oturum kurar',
  'POST /api/payment/callback': 'PayTR HMAC doğrulamalı sunucu callback’i',
  'GET /api/push': 'oturumsuz VAPID public key döndürebilir',
};

const DIRECT_PRISMA_ROUTE_ALLOWLIST = [
  'app/api/backup/route.ts',
  'app/api/cron/cleanup/route.ts',
  'app/api/demo-request/route.ts',
  'app/api/mobile/v1/bootstrap/route.ts',
  'app/api/payment/callback/route.ts',
  'app/api/payment/start/route.ts',
  'app/api/superadmin/demo/route.ts',
  'app/api/superadmin/mobile-config/route.ts',
  'app/api/superadmin/route.ts',
].sort();

const BODY_VALIDATION_ALLOWLIST = [
  'DELETE /api/deneme/exams/:id',
  'DELETE /api/superadmin/demo',
  'POST /api/demo-request',
  'POST /api/deneme/exams/:id/compute',
  'POST /api/gate',
  'POST /api/mobile/v1/auth/logout',
  'POST /api/mobile/v1/session-exchange',
  'POST /api/optik',
  'POST /api/optik/upload',
  'POST /api/payment/callback',
  'POST /api/program-solve',
  'POST /api/push',
  'POST /api/resources/upload',
  'POST /api/students/import',
  'POST /api/upload',
].sort();

describe('API mimari sözleşmeleri', () => {
  it('route ve handler envanteri bilinçli değişir', () => {
    expect(routeFiles()).toHaveLength(92);
    expect(handlers()).toHaveLength(169);
  });

  it('merkezi wrapper dışındaki her API kapısı gerekçeli allowlist’tedir', () => {
    const actual = handlers()
      .filter((h) => h.guard === 'custom/public')
      .map((h) => `${h.method} ${h.route}`)
      .sort();
    expect(actual).toEqual(Object.keys(CUSTOM_HANDLER_ALLOWLIST).sort());
  });

  it('ham Prisma kullanan route’lar dar ve görünür bir allowlist’tedir', () => {
    const actual = routeFiles()
      .filter((file) => /from\s+['"]@\/lib\/prisma['"]/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(process.cwd(), file))
      .sort();
    expect(actual).toEqual(DIRECT_PRISMA_ROUTE_ALLOWLIST);
  });

  it('standart parseBody dışındaki mutasyonlar bilinçli allowlist’tedir', () => {
    const actual = handlers()
      .filter((h) => /^(POST|PUT|PATCH|DELETE)$/.test(h.method))
      .filter((h) => !fs.readFileSync(h.file, 'utf8').includes('parseBody('))
      .map((h) => `${h.method} ${h.route}`)
      .sort();
    expect(actual).toEqual(BODY_VALIDATION_ALLOWLIST);
  });
});
