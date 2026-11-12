import { restoreLedgerBackup } from '../../core/src/backup.js';

const [source, dest] = process.argv.slice(2);
if (!source || !dest) {
  console.error('Usage: npm run restore -- <backup-file> <destination-ledger>');
  process.exit(1);
}

try {
  restoreLedgerBackup(source, dest, process.env.SHLITA_RESTORE_OVERWRITE === 'true');
  console.log(JSON.stringify({ event: 'restore', source, dest, integrity: 'ok' }));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Restore failed.');
  process.exit(1);
}
