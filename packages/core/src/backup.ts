import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function restoreLedgerBackup(source: string, dest: string, overwrite: boolean): void {
  if (!fs.existsSync(source)) throw new Error('Backup file does not exist.');
  if (fs.existsSync(dest) && !overwrite) {
    throw new Error('Refusing to overwrite an existing ledger.');
  }
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (file: string, options?: { readOnly?: boolean }) => {
      prepare(sql: string): { get(): { integrity_check: string } };
      close(): void;
    };
  };
  const opened = new DatabaseSync(source, { readOnly: true });
  try {
    const row = opened.prepare('PRAGMA integrity_check').get();
    if (row.integrity_check !== 'ok') throw new Error('Backup failed integrity check.');
  } finally {
    opened.close();
  }
  fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
  fs.copyFileSync(source, dest);
  fs.chmodSync(dest, 0o600);
}

export function pruneBackupFiles(directory: string, keep: number): string[] {
  if (!fs.existsSync(directory)) return [];
  const files = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.db'))
    .map((name) => {
      const full = path.join(directory, name);
      return { full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((left, right) => right.mtime - left.mtime);
  const removed: string[] = [];
  for (const file of files.slice(Math.max(keep, 0))) {
    fs.rmSync(file.full, { force: true });
    removed.push(file.full);
  }
  return removed;
}
