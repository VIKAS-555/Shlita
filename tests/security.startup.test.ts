import { describe, it, expect, afterEach } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  children.length = 0;
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function startGateway(env: Record<string, string>) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'packages/gateway/src/index.ts'], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let output = '';
  child.stdout?.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    output += chunk.toString();
  });
  return {
    child,
    output: () => output,
  };
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve(null);
    }, timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function waitForHealth(port: number): Promise<void> {
  const deadline = Date.now() + 8000;
  let lastError = 'gateway did not become healthy';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.status === 200) return;
      lastError = `health status ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'connection failed';
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(lastError);
}

describe('gateway process startup', () => {
  it('fails closed on unsafe production startup and does not print credentials', async () => {
    const started = startGateway({ SHLITA_ENV: 'production' });
    const code = await waitForExit(started.child, 5000);
    const output = started.output();
    expect(code).toBe(1);
    expect(output).not.toContain('listening');
    expect(output).not.toContain('shlt_live_');
    expect(output).not.toContain('shlt_operator_master');
  });

  it('serves an authorized local configuration and keeps enrolled keys across restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shlita-startup-'));
    const port = await freePort();
    const operatorKey = `local-operator-${'d'.repeat(32)}`;
    const researcherKey = 'shlt_test_startup_researcher_key';
    const env = {
      SHLITA_ENV: 'development',
      SHLITA_OPERATOR_KEY: operatorKey,
      SHLITA_OPERATOR_ORG: 'org-startup',
      SHLITA_ALLOW_SIMULATION: 'true',
      SHLITA_SEED_DEMO: 'true',
      SHLITA_DEMO_KEY_RESEARCHER: researcherKey,
      SHLITA_DB_PATH: path.join(dir, 'ledger.db'),
      SHLITA_STATE_DIR: dir,
      SHLITA_CORS_ORIGINS: 'http://localhost:5173',
      PORT: String(port),
    };

    const first = startGateway(env);
    try {
      await waitForHealth(port);
      const output = first.output();
      expect(output).not.toContain(operatorKey);
      expect(output).not.toContain(researcherKey);

      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);

      const anonymous = await fetch(`http://127.0.0.1:${port}/v1/agents`);
      expect(anonymous.status).toBe(401);

      const invalid = await fetch(`http://127.0.0.1:${port}/v1/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-shlita-api-key': 'shlt_test_not_a_real_key' },
        body: JSON.stringify({ vendor: 'api.helius.xyz', path: '/v0/token-metadata', simulate: true, idempotencyKey: 'startup-invalid-key-01' }),
      });
      expect(invalid.status).toBe(401);

      const proxy = await fetch(`http://127.0.0.1:${port}/v1/proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-shlita-api-key': researcherKey,
          'x-shlita-simulation': 'true',
        },
        body: JSON.stringify({
          agentId: 'agent-researcher-01',
          vendor: 'api.helius.xyz',
          path: '/v0/token-metadata',
          simulate: true,
          idempotencyKey: 'startup-allow-01',
        }),
      });
      expect(proxy.status).toBe(200);
      expect(proxy.headers.get('x-shlita-decision')).toBe('ALLOWED');

      const frozen = await fetch(`http://127.0.0.1:${port}/v1/agents/agent-researcher-01/freeze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-shlita-operator-key': operatorKey },
        body: JSON.stringify({ reason: 'startup check' }),
      });
      expect(frozen.status).toBe(200);

      const agentAttempt = await fetch(`http://127.0.0.1:${port}/v1/agents/agent-researcher-01/unfreeze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-shlita-api-key': researcherKey },
        body: JSON.stringify({}),
      });
      expect(agentAttempt.status).toBe(401);
    } finally {
      first.child.kill('SIGTERM');
      await waitForExit(first.child, 3000);
    }

    const restarted = startGateway(env);
    try {
      await waitForHealth(port);
      const proxy = await fetch(`http://127.0.0.1:${port}/v1/proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-shlita-api-key': researcherKey,
          'x-shlita-simulation': 'true',
        },
        body: JSON.stringify({
          vendor: 'api.helius.xyz',
          path: '/v0/token-metadata',
          simulate: true,
          idempotencyKey: 'startup-frozen-01',
        }),
      });
      expect(proxy.status).toBe(403);
      expect((await proxy.json()).reason).toBe('AGENT_FROZEN');
      expect(restarted.output()).not.toContain(operatorKey);
      expect(restarted.output()).not.toContain(researcherKey);
    } finally {
      restarted.child.kill('SIGTERM');
      await waitForExit(restarted.child, 3000);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
