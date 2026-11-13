import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { exec, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it, expect } from 'vitest';

const execAsync = promisify(exec);

describe('Step 12 — Live Acceptance Check Automation', () => {
  it('reports all 4 live checks as BLOCKED independently of public DNS when DNS is unresolvable', async () => {
    // Tests missing-DNS hermetically without contacting public DNS servers
    const { stdout } = await execAsync(
      './scripts/verify-live-staging.sh --check-only --dns-status nxdomain',
      {
        timeout: 5000,
        encoding: 'utf-8',
      }
    );

    expect(stdout).toContain('LIVE-HTTPS-01 (Public TLS & /ready HTTP 200)       : BLOCKED');
    expect(stdout).toContain('LIVE-PERSIST-01 (Ledger Persistence Post-Redeploy) : BLOCKED');
    expect(stdout).toContain('LIVE-ALERT-01 (Outage & Recovery Notifications)    : BLOCKED');
    expect(stdout).toContain('LIVE-RESTORE-01 (Worker Snapshot Restore on Host)  : BLOCKED');

    expect(stdout).toContain('Result: BLOCKED (DNS NXDOMAIN');
    expect(stdout).toContain('Blocker: BLOCKER-DNS-01 (Public DNS delegation missing)');
    expect(stdout).toContain('BLOCKER-HOST-01');
    expect(stdout).toContain('BLOCKER-SECRET-01');
    expect(stdout).toContain('Maintainer (XiaoArnav)');
    expect(stdout).toContain('Hold Step 13 until cloud VM, DNS record, and staging secrets are supplied');
  });

  it('rejects plain HTTP 200 and fails LIVE-HTTPS-01 (HTTPS with TLS verification required)', async () => {
    // Spin up local test plain HTTP server returning 200 on /ready
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

      // Must strictly fail because plain HTTP does not meet the HTTPS/TLS requirement
      expect(stdout).toContain('Result: FAILED (HTTPS is required; target URL is plain HTTP');
      expect(stdout).toContain('LIVE-HTTPS-01 (Public TLS & /ready HTTP 200)       : FAILED');
      expect(stdout).not.toContain('LIVE-HTTPS-01 (Public TLS & /ready HTTP 200)       : PASS');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('strictly rejects unverified TLS certificates when curl -k is omitted', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shlita-tls-test-'));
    const keyPath = path.join(tmpDir, 'test-key.pem');
    const certPath = path.join(tmpDir, 'test-cert.pem');

    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${keyPath}" -out "${certPath}" -days 1 -subj "/CN=127.0.0.1"`,
      { stdio: 'pipe' }
    );

    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);

    const server = https.createServer({ key, cert }, (req, res) => {
      if (req.url === '/ready') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ready' }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    try {
      // Connect without --cacert: normal certificate verification should reject the self-signed cert
      const { stdout } = await execAsync(
        `./scripts/verify-live-staging.sh --target-url "https://127.0.0.1:${port}" --check-only`,
        { timeout: 5000, encoding: 'utf-8' }
      );

      expect(stdout).toContain('Result: FAILED (TLS certificate verification failed:');
      expect(stdout).toContain('LIVE-HTTPS-01 (Public TLS & /ready HTTP 200)       : FAILED');
      expect(stdout).not.toContain('LIVE-HTTPS-01 (Public TLS & /ready HTTP 200)       : PASS');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('passes LIVE-HTTPS-01 when valid HTTPS and verified certificate return HTTP 200', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shlita-tls-pass-'));
    const keyPath = path.join(tmpDir, 'test-key.pem');
    const certPath = path.join(tmpDir, 'test-cert.pem');

    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${keyPath}" -out "${certPath}" -days 1 -subj "/CN=127.0.0.1"`,
      { stdio: 'pipe' }
    );

    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);

    const server = https.createServer({ key, cert }, (req, res) => {
      if (req.url === '/ready') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ready' }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    try {
      // Pass the CA cert to verify normal certificate verification succeeds
      const { stdout } = await execAsync(
        `./scripts/verify-live-staging.sh --target-url "https://127.0.0.1:${port}" --cacert "${certPath}" --check-only`,
        { timeout: 5000, encoding: 'utf-8' }
      );

      expect(stdout).toContain('Result: PASS (HTTP 200, valid TLS handshake and verified certificate)');
      expect(stdout).toContain('LIVE-HTTPS-01 (Public TLS & /ready HTTP 200)       : PASS');
      expect(stdout).toContain('LIVE-PERSIST-01 (Ledger Persistence Post-Redeploy) : BLOCKED');
      expect(stdout).toContain('LIVE-ALERT-01 (Outage & Recovery Notifications)    : BLOCKED');
      expect(stdout).toContain('LIVE-RESTORE-01 (Worker Snapshot Restore on Host)  : BLOCKED');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
