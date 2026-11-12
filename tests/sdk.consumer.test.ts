import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);

describe('independent SDK installation', () => {
  it('packs the SDK and runs it from a project outside the repository', async () => {
    const result = await exec(process.execPath, ['scripts/sdk-consumer-check.mjs'], {
      cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
      timeout: 120_000,
      maxBuffer: 2_000_000,
    });
    expect(result.stdout).toContain('"installed":true');
    expect(result.stdout).toContain('"reservedAmountMicroUsdc":"10000"');
    expect(result.stdout).not.toMatch(/shlt_live_|operator-key/);
  }, 120_000);
});
