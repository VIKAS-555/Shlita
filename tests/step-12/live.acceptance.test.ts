import http from 'node:http';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it, expect } from 'vitest';

const execAsync = promisify(exec);

describe('Step 12 — Live Acceptance Check Automation', () => {
  it('reports all 4 live checks as BLOCKED with clear blockers when run against unprovisioned host', async () => {
    const { stdout } = await execAsync('./scripts/verify-live-staging.sh --check-only', {
      timeout: 5000,
      encoding: 'utf-8',
    });

    expect(stdout).toContain('LIVE-HTTPS-01');
    expect(stdout).toContain('LIVE-PERSIST-01');
    expect(stdout).toContain('LIVE-ALERT-01');
    expect(stdout).toContain('LIVE-RESTORE-01');

    expect(stdout).toContain('BLOCKER-DNS-01');
    expect(stdout).toContain('BLOCKER-HOST-01');
    expect(stdout).toContain('BLOCKER-SECRET-01');
    expect(stdout).toContain('Maintainer (XiaoArnav)');
    expect(stdout).toContain('Hold Step 13 until cloud VM, DNS record, and staging secrets are supplied');
  });

  it('detects live HTTPS status correctly when target endpoint responds with HTTP 200', async () => {
    // Spin up local test HTTP server mimicking /ready
    const server = http.createServer((req, res) => {
      if (req.url === '/ready') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ready', database: 'connected' }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    try {
      const { stdout } = await execAsync(
        `./scripts/verify-live-staging.sh --target-url "http://127.0.0.1:${port}" --check-only`,
        { timeout: 5000, encoding: 'utf-8' }
      );
      expect(stdout).toContain('LIVE-HTTPS-01 (Public TLS & /ready HTTP 200)       : PASS');
      // Confirms other 3 checks remain BLOCKED
      expect(stdout).toContain('LIVE-PERSIST-01 (Ledger Persistence Post-Redeploy) : BLOCKED');
      expect(stdout).toContain('LIVE-ALERT-01 (Outage & Recovery Notifications)    : BLOCKED');
      expect(stdout).toContain('LIVE-RESTORE-01 (Worker Snapshot Restore on Host)  : BLOCKED');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
