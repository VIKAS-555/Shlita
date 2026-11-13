import { test, expect } from '@playwright/test';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = 4077;
const OPERATOR_KEY = 'playwright-test-operator-key-32chars-xyz';
const OPERATOR_ORG = 'org-browser-audit';
const TEMP_DIR = path.join(os.tmpdir(), `shlita-playwright-${Date.now()}`);
const DB_PATH = path.join(TEMP_DIR, 'ledger.db');

let gatewayProcess: ChildProcess;

test.beforeAll(async () => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  // Start local gateway using repository supported entry point
  gatewayProcess = spawn('node', ['--import', 'tsx', 'packages/gateway/src/index.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      SHLITA_ENV: 'development',
      SHLITA_OPERATOR_KEY: OPERATOR_KEY,
      SHLITA_OPERATOR_ORG: OPERATOR_ORG,
      SHLITA_ALLOW_SIMULATION: 'true',
      SHLITA_DB_PATH: DB_PATH,
      SHLITA_STATE_DIR: TEMP_DIR,
    },
    stdio: 'pipe',
  });

  // Wait for gateway to be ready
  const start = Date.now();
  let ready = false;
  while (Date.now() - start < 15_000) {
    try {
      const res = await fetch(`http://localhost:${PORT}/ready`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // Retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!ready) {
    throw new Error('Gateway failed to start within 15 seconds.');
  }
});

test.afterAll(async () => {
  if (gatewayProcess && !gatewayProcess.killed) {
    gatewayProcess.kill('SIGTERM');
  }
  try {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup error
  }
});

test('dashboard end-to-end browser verification flow', async ({ page }) => {
  // ─── 1. Operator Sign-In ──────────────────────────────────────────────────
  await page.goto(`http://localhost:${PORT}`);
  await expect(page.getByRole('heading', { name: 'Operator sign-in' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('The key is checked by the gateway and is not stored in this browser.')).toBeVisible();

  // Enter operator key and submit
  const keyInput = page.locator('input[type="password"]');
  await keyInput.fill(OPERATOR_KEY);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Confirm dashboard loads
  await expect(page.getByRole('heading', { name: 'Live ledger' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(`Organization ${OPERATOR_ORG}.`)).toBeVisible();

  // ─── 2. Enroll a Test Agent ───────────────────────────────────────────────
  const agentId = 'agent-browser-audit-01';
  await page.locator('input[name="agentId"]').fill(agentId);
  await page.locator('input[name="vendor"]').fill('api.helius.xyz');
  await page.locator('input[name="perCall"]').fill('50000');
  await page.locator('input[name="budget"]').fill('1000000');
  await page.getByRole('button', { name: 'Enroll agent' }).click();

  // Verify agent is enrolled and active
  const agentCard = page.locator('li').filter({ hasText: agentId });
  await expect(agentCard).toBeVisible({ timeout: 10_000 });
  await expect(agentCard.getByText('ACTIVE', { exact: true })).toBeVisible();

  // Retrieve issued API key from notification
  const keyNotice = await page.locator('text=Copy this agent key now').textContent();
  expect(keyNotice).toBeTruthy();
  const apiKeyMatch = keyNotice!.match(/shlt_[a-zA-Z0-9_-]+/);
  expect(apiKeyMatch).toBeTruthy();
  const agentApiKey = apiKeyMatch![0];

  // Verify initial accounted spend is 0
  await expect(agentCard.getByText('Accounted 0.000000 of 1.000000.')).toBeVisible();

  // ─── 3. Generate Simulated Operation & Verify Live Update (No Reload) ─────
  const opKey = `browser-op-${Date.now()}`;
  const proxyRes = await fetch(`http://localhost:${PORT}/v1/proxy`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-shlita-api-key': agentApiKey,
      'x-shlita-simulation': 'true',
    },
    body: JSON.stringify({
      agentId,
      vendor: 'api.helius.xyz',
      method: 'POST',
      path: '/v0/token-metadata',
      body: { mints: ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'] },
      idempotencyKey: opKey,
      simulate: true,
    }),
  });
  expect(proxyRes.status).toBe(200);

  // Verify that the dashboard shows the live event and correct spend WITHOUT page reload
  await expect(agentCard.getByText('Accounted 0.010000 of 1.000000.')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('table').getByText(agentId)).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('table').getByText('ACCOUNTING_COMMITTED')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('[data-testid="live-telemetry"]')).toContainText('APPROVED', { timeout: 8_000 });
  await expect(page.locator('[data-testid="live-telemetry"]')).toContainText('$0.0100 USDC', { timeout: 8_000 });

  // ─── 4. Freeze Agent through UI & Confirm Persistence After Reload ────────
  await agentCard.getByRole('button', { name: 'Freeze', exact: true }).click();
  await expect(agentCard.getByText('AGENT_FROZEN', { exact: true })).toBeVisible({ timeout: 8_000 });

  // Reload page to verify persistence
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Live ledger' })).toBeVisible({ timeout: 10_000 });
  const reloadedCard = page.locator('li').filter({ hasText: agentId });
  await expect(reloadedCard.getByText('AGENT_FROZEN', { exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(reloadedCard.getByText('Freeze reason: Operator freeze')).toBeVisible();

  // ─── 5. Sign Out & Confirm Return to Login Screen ─────────────────────────
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Operator sign-in' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('input[type="password"]')).toBeVisible();
});
