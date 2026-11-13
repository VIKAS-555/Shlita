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
const targetUrl = process.env.STAGING_GATEWAY_URL || 'http://127.0.0.1:4000';
const probeCount = Number(process.env.PROBE_COUNT || '5');

console.log(`[Shlita Monitor] Probing target: ${targetUrl} (Probes: ${probeCount})`);

async function measureLatency(url) {
  const start = performance.now();
  const res = await fetch(url);
  const durationMs = Number((performance.now() - start).toFixed(2));
  return { status: res.status, ok: res.ok, durationMs };
}

async function runProbes() {
  const healthUrl = `${targetUrl.replace(/\/$/, '')}/health`;
  const readyUrl = `${targetUrl.replace(/\/$/, '')}/ready`;
  const metricsUrl = `${targetUrl.replace(/\/$/, '')}/metrics`;

  // 1. Health check
  const healthRes = await fetch(healthUrl);
  if (!healthRes.ok) {
    throw new Error(`Health check failed with HTTP ${healthRes.status}`);
  }
  const healthJson = await healthRes.json();

  // 2. Readiness check
  const readyRes = await fetch(readyUrl);
  if (!readyRes.ok) {
    throw new Error(`Readiness check failed with HTTP ${readyRes.status}`);
  }

  // 3. Metrics scrape
  const metricsRes = await fetch(metricsUrl);
  const metricsAvailable = metricsRes.ok;

  // 4. Latency sampling
  const latencies = [];
  for (let i = 0; i < probeCount; i++) {
    const probe = await measureLatency(readyUrl);
    latencies.push(probe.durationMs);
  }

  const avgLatencyMs = Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2));
  const minLatencyMs = Math.min(...latencies);
  const maxLatencyMs = Math.max(...latencies);

  const report = {
    target: targetUrl,
    timestamp: new Date().toISOString(),
    status: 'HEALTHY',
    health: healthJson,
    metricsEndpoint: metricsAvailable ? 'UP' : 'UNAVAILABLE',
    latency: {
      samples: probeCount,
      minMs: minLatencyMs,
      maxMs: maxLatencyMs,
      avgMs: avgLatencyMs,
    },
  };

  console.log(JSON.stringify(report, null, 2));
  return report;
}

runProbes().catch((err) => {
  console.error('[Shlita Monitor] Probe Failed:', err.message);
  process.exit(1);
});
