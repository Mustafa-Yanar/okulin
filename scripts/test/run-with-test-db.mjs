import { spawn } from 'node:child_process';
import { configureTestDatabase } from './db-guard.mjs';

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error('Kullanım: node scripts/test/run-with-test-db.mjs <komut> [argümanlar]');
  process.exit(2);
}

const info = configureTestDatabase();
console.error(`[test-db] güvenli hedef: ${info.host}:${info.port}/${info.database}`);

const child = spawn(command[0], command.slice(1), {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(`[test-db] komut başlatılamadı: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[test-db] komut sinyalle kapandı: ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
