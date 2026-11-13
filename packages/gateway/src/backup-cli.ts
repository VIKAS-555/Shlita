import fs from 'node:fs';
import path from 'node:path';
import { createPolicyEngine } from '../../core/src/policy-engine.js';
import { pruneBackupFiles } from '../../core/src/backup.js';

const dbPath = process.env.SHLITA_DB_PATH?.trim();
const backupDir = process.env.SHLITA_BACKUP_DIR?.trim();
const keep = Number(process.env.SHLITA_BACKUP_RETENTION ?? '14');

if (!dbPath || dbPath === ':memory:' || !backupDir) {
  console.error('SHLITA_DB_PATH and SHLITA_BACKUP_DIR are required.');
  process.exit(1);
}
if (!Number.isInteger(keep) || keep < 1) {
  console.error('SHLITA_BACKUP_RETENTION must be a positive integer.');
  process.exit(1);
}

const engine = createPolicyEngine(dbPath);
try {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(backupDir, `ledger-${stamp}.db`);
  await engine.backupTo(dest);
  const removed = pruneBackupFiles(backupDir, keep);
  console.log(JSON.stringify({ event: 'backup', file: dest, removed: removed.length, integrity: 'ok' }));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Backup failed.');
  process.exitCode = 1;
} finally {
  engine.close();
  if (process.exitCode && process.exitCode !== 0) {
    process.exit(process.exitCode);
  }
}
