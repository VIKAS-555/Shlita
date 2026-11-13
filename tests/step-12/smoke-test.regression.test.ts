import http from 'node:http';
import { spawn } from 'node:child_process';
import { describe, it, expect } from 'vitest';

function startMockServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  return new Promise<{ server: http.Server; url: string }>((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function runSmokeTestCli(env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/staging-smoke-test.mjs'], {
      env: {
        ...process.env,
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

describe('Step 12 — Staging Smoke Test Regression', () => {
  it('fails and omits HEALTHY when a readiness sample returns HTTP 503 after the initial check succeeds', async () => {
    let readyCalls = 0;
    const { server, url } = await startMockServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', version: '0.1.0' }));
      } else if (req.url === '/ready') {
        readyCalls++;
        if (readyCalls === 1) {
          // Initial check succeeds
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ready' }));
        } else {
          // Subsequent probe sample fails with 503
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'DATABASE_LOCKED' }));
        }
      } else if (req.url === '/metrics') {
        res.writeHead(200);
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    try {
      const { code, stdout, stderr } = await runSmokeTestCli({
        STAGING_GATEWAY_URL: url,
        PROBE_COUNT: '3',
        SHLITA_TEST_API_KEY: '',
      });

      // Regression check: must exit nonzero, omit HEALTHY, and identify /ready HTTP 503
      expect(code).not.toBe(0);
      expect(stdout).not.toContain('"status": "HEALTHY"');
      expect(stderr).toMatch(/\/ready.*503/i);
    } finally {
      server.close();
    }
  });

  it('fails and omits HEALTHY when an enabled proxy sample returns a non-2xx response', async () => {
    const { server, url } = await startMockServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', version: '0.1.0' }));
      } else if (req.url === '/ready') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ready' }));
      } else if (req.url === '/metrics') {
        res.writeHead(200);
        res.end();
      } else if (req.url === '/v1/proxy') {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'UPSTREAM_GATEWAY_TIMEOUT' }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    try {
      const { code, stdout, stderr } = await runSmokeTestCli({
        STAGING_GATEWAY_URL: url,
        PROBE_COUNT: '2',
        SHLITA_TEST_API_KEY: 'shlt_test_probe_key_001',
      });

      // Regression check: must exit nonzero, omit HEALTHY, and identify /v1/proxy HTTP 502
      expect(code).not.toBe(0);
      expect(stdout).not.toContain('"status": "HEALTHY"');
      expect(stderr).toMatch(/\/v1\/proxy.*502/i);
    } finally {
      server.close();
    }
  });

  it('succeeds without a test key and reports OMITTED_NO_TEST_KEY for proxy latency', async () => {
    const { server, url } = await startMockServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', version: '0.1.0' }));
      } else if (req.url === '/ready') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ready' }));
      } else if (req.url === '/metrics') {
        res.writeHead(200);
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    try {
      const { code, stdout } = await runSmokeTestCli({
        STAGING_GATEWAY_URL: url,
        PROBE_COUNT: '2',
        SHLITA_TEST_API_KEY: '',
      });

      expect(code).toBe(0);
      expect(stdout).toContain('"status": "HEALTHY"');
      expect(stdout).toContain('"status": "OMITTED_NO_TEST_KEY"');
      expect(stdout).toContain('"readinessLatency"');
    } finally {
      server.close();
    }
  });

  it('succeeds with a test key and reports separate readiness and proxy timings', async () => {
    const { server, url } = await startMockServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', version: '0.1.0' }));
      } else if (req.url === '/ready') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ready' }));
      } else if (req.url === '/metrics') {
        res.writeHead(200);
        res.end();
      } else if (req.url === '/v1/proxy') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: 'mocked_sandbox_ok' }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    try {
      const { code, stdout } = await runSmokeTestCli({
        STAGING_GATEWAY_URL: url,
        PROBE_COUNT: '2',
        SHLITA_TEST_API_KEY: 'shlt_test_probe_key_001',
      });

      expect(code).toBe(0);
      expect(stdout).toContain('"status": "HEALTHY"');
      expect(stdout).toContain('"status": "MEASURED"');
      expect(stdout).toContain('"endpoint": "/v1/proxy"');
      expect(stdout).toContain('"endpoint": "/ready"');
    } finally {
      server.close();
    }
  });
});
