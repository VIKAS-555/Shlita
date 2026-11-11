import { spawnSync } from 'node:child_process';

const validator = spawnSync('solana-test-validator', ['--version'], { encoding: 'utf8' });
if (validator.status !== 0) {
  console.error('BLOCKED: solana-test-validator is not installed, so funded on-chain settlement was not executed.');
  console.error(validator.error ? validator.error.message : validator.stderr);
  process.exit(2);
}

console.error('BLOCKED: the Subscriptions program binary is not available in this environment, so the local validator was not asked to move tokens.');
process.exit(2);
