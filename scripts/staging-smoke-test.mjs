#!/usr/bin/env node
/**
 * Shlita Staging Smoke Test & Monitoring Probe
 *
 * Runs non-billable, uncredentialed checks against a staging target:
 * 1. Checks GET /health (version, status)
 * 2. Checks GET /ready (database connectivity)
 * 3. Measures HTTP round-trip latency over N probes
 * 4. Outputs structured JSON telemetry metrics
 */
import { fileURLToPath } from 'node:url';

export async function measureLatency(url) {
  const start = performance.now();
  const res = await fetch(url);
  const durationMs = Number((performance.now() - start).toFixed(2));
  return { status: res.status, ok: res.ok, durationMs };
}

export async function runProbes(options = {}) {
  const targetUrl = options.targetUrl || process.env.STAGING_GATEWAY_URL || 'http://127.0.0.1:4000';
  const probeCount = Number(options.probeCount ?? process.env.PROBE_COUNT ?? '5');

  console.log(`[Shlita Monitor] Probing target: ${targetUrl} (Probes: ${probeCount})`);

  const healthUrl = `${targetUrl.replace(/\/$/, '')}/health`;
  const readyUrl = `${targetUrl.replace(/\/$/, '')}/ready`;
  const metricsUrl = `${targetUrl.replace(/\/$/, '')}/metrics`;

  // 1. Health check
  const healthRes = await fetch(healthUrl);
  if (!healthRes.ok) {
    throw new Error(`Health check failed for /health with HTTP ${healthRes.status}`);
  }
  const healthJson = await healthRes.json();

  // 2. Readiness check
  const readyRes = await fetch(readyUrl);
  if (!readyRes.ok) {
    throw new Error(`Readiness check failed for /ready with HTTP ${readyRes.status}`);
  }

  // 3. Metrics scrape
  const metricsRes = await fetch(metricsUrl);
  const metricsAvailable = metricsRes.ok;

  // 4. Readiness latency sampling (/ready endpoint)
  const readinessLatencies = [];
  for (let i = 0; i < probeCount; i++) {
    const probe = await measureLatency(readyUrl);
    if (!probe.ok) {
      throw new Error(`Readiness probe sample failed for /ready with HTTP ${probe.status}`);
    }
    readinessLatencies.push(probe.durationMs);
  }

  const avgReadinessLatencyMs = Number((readinessLatencies.reduce((a, b) => a + b, 0) / readinessLatencies.length).toFixed(2));
  const minReadinessLatencyMs = Math.min(...readinessLatencies);
  const maxReadinessLatencyMs = Math.max(...readinessLatencies);

  // 5. Proxy latency sampling (/v1/proxy endpoint, optional with SHLITA_TEST_API_KEY)
  const testApiKey = (options.testApiKey !== undefined ? options.testApiKey : process.env.SHLITA_TEST_API_KEY)?.trim();
  let proxyLatencyReport = {
    status: 'OMITTED_NO_TEST_KEY',
    description: 'Provide SHLITA_TEST_API_KEY to probe /v1/proxy latency separately from /ready readiness latency',
  };

  if (testApiKey) {
    const proxyUrl = `${targetUrl.replace(/\/$/, '')}/v1/proxy`;
    const proxyLatencies = [];
    for (let i = 0; i < probeCount; i++) {
      const start = performance.now();
      const pRes = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shlita-api-key': testApiKey,
        },
        body: JSON.stringify({
          agentId: 'staging-monitor-agent',
          vendor: 'api.helius.xyz',
          method: 'POST',
          path: '/v0/token-metadata',
          idempotencyKey: `probe-${Date.now()}-${i}`,
        }),
      });
      const durationMs = Number((performance.now() - start).toFixed(2));
      if (!pRes.ok) {
        throw new Error(`Proxy probe sample failed for /v1/proxy with HTTP ${pRes.status}`);
      }
      proxyLatencies.push(durationMs);
    }
    proxyLatencyReport = {
      status: 'MEASURED',
      endpoint: '/v1/proxy',
      samples: probeCount,
      minMs: Math.min(...proxyLatencies),
      maxMs: Math.max(...proxyLatencies),
      avgMs: Number((proxyLatencies.reduce((a, b) => a + b, 0) / proxyLatencies.length).toFixed(2)),
    };
  }

  const report = {
    target: targetUrl,
    timestamp: new Date().toISOString(),
    status: 'HEALTHY',
    health: healthJson,
    metricsEndpoint: metricsAvailable ? 'UP' : 'UNAVAILABLE',
    readinessLatency: {
      endpoint: '/ready',
      samples: probeCount,
      minMs: minReadinessLatencyMs,
      maxMs: maxReadinessLatencyMs,
      avgMs: avgReadinessLatencyMs,
    },
    proxyLatency: proxyLatencyReport,
  };

  console.log(JSON.stringify(report, null, 2));
  return report;
}

const isDirectRun = Boolean(process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]);
if (isDirectRun) {
  runProbes().catch((err) => {
    console.error(`[Shlita Monitor] Probe Failed: ${err.message}`);
    process.exit(1);
  });
}
