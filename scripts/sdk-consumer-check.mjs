import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const operatorKey = crypto.randomBytes(24).toString('hex');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'shlita-sdk-work-'));
const consumer = path.join(work, 'consumer');
const ledger = path.join(work, 'ledger.db');
fs.mkdirSync(consumer);

function redact(text) {
  return String(text).split(operatorKey).join('[redacted]');
}

function walk(directory, root = directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, root));
    else files.push(path.relative(root, full));
  }
  return files;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitReady(url, child, logPath) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${url}/ready`);
      if (response.ok) return;
    } catch {
      // The process is still binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(redact(fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : 'gateway did not become ready'));
}

function startGateway(port, logPath) {
  const log = fs.createWriteStream(logPath, { flags: 'a' });
  const child = spawn(process.execPath, ['--import', 'tsx', 'packages/gateway/src/index.ts'], {
    cwd: root,
    env: {
      ...process.env,
      SHLITA_ENV: 'development',
      SHLITA_OPERATOR_KEY: operatorKey,
      SHLITA_OPERATOR_ORG: 'org-consumer',
      SHLITA_ALLOW_SIMULATION: 'true',
      SHLITA_SEED_DEMO: 'false',
      SHLITA_DB_PATH: ledger,
      SHLITA_STATE_DIR: work,
      SHLITA_BACKUP_DIR: path.join(work, 'backups'),
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return child;
}

async function stopGateway(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const logPath = path.join(work, 'gateway.log');
let gateway;
try {
  await exec(process.execPath, ['node_modules/typescript/lib/tsc.js', '-p', 'packages/sdk/tsconfig.json'], { cwd: root });
  const { stdout: packedJson } = await exec('npm', ['pack', '--json', '--pack-destination', work], {
    cwd: path.join(root, 'packages/sdk'),
  });
  const packed = JSON.parse(packedJson);
  const tarball = path.join(work, packed[0].filename);
  const listing = (await exec('tar', ['-tzf', tarball])).stdout;
  const names = listing.split('\n').filter(Boolean);
  if (names.some((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))) {
    throw new Error('The archive contains TypeScript source.');
  }
  if (names.some((name) => /gateway|ledger|\.db$|\.env|secret/i.test(name))) {
    throw new Error(`The archive contains private material: ${names.join(', ')}`);
  }
  if (!names.some((name) => name.endsWith('dist/index.js')) || !names.some((name) => name.endsWith('dist/index.d.ts'))) {
    throw new Error('The archive is missing compiled JavaScript or declarations.');
  }

  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({
    name: 'shlita-sdk-consumer',
    private: true,
    type: 'module',
  }));
  await exec('npm', ['install', '--no-fund', '--no-audit', '--omit=dev', tarball], { cwd: consumer });
  const installed = path.join(consumer, 'node_modules', 'shlita-sdk');
  const installedFiles = walk(installed);
  if (!installedFiles.includes(path.join('dist', 'index.js'))) {
    throw new Error(`Installed package has no compiled entry. Found: ${installedFiles.join(', ')}`);
  }
  const entry = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
  if (entry.exports['.'].import !== './dist/index.js') throw new Error('Package exports do not point at compiled JavaScript.');
  const compiled = fs.readFileSync(path.join(installed, 'dist', 'index.js'), 'utf8');
  if (compiled.includes('packages/gateway') || compiled.includes(operatorKey)) {
    throw new Error('Compiled SDK contains gateway source or a credential.');
  }

  fs.writeFileSync(path.join(consumer, 'check.ts'), `
import { ShlitaAgentClient, ShlitaOperatorClient, type ProxyResult } from 'shlita-sdk';
const agent: ShlitaAgentClient = new ShlitaAgentClient({ apiKey: '${'a'.repeat(16)}', baseUrl: 'http://127.0.0.1:9' });
const operator: ShlitaOperatorClient = new ShlitaOperatorClient({ operatorKey: '${'b'.repeat(16)}', baseUrl: 'http://127.0.0.1:9' });
const result: ProxyResult | undefined = undefined;
void agent;
void operator;
void result;
`);
  fs.writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    files: ['check.ts'],
  }));
  await exec(process.execPath, [path.join(root, 'node_modules/typescript/lib/tsc.js'), '-p', path.join(consumer, 'tsconfig.json')], { cwd: consumer });

  fs.cpSync(path.join(root, 'examples'), path.join(consumer, 'examples'), { recursive: true });
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  gateway = startGateway(port, logPath);
  await waitReady(baseUrl, gateway, logPath);

  const sdk = await import(pathToFileURL(path.join(installed, 'dist', 'index.js')).href);
  const operator = new sdk.ShlitaOperatorClient({ operatorKey, baseUrl });
  const issued = await operator.enrollAgent({
    agentId: 'research-agent',
    allowedVendors: ['api.helius.xyz'],
    maxPerCallMicroUsdc: '50000',
    periodBudgetMicroUsdc: '1000000',
  });
  const env = {
    ...process.env,
    SHLITA_GATEWAY_URL: baseUrl,
    SHLITA_API_KEY: issued.apiKey,
    SHLITA_OPERATOR_KEY: operatorKey,
    SHLITA_AGENT_ID: 'research-agent',
  };
  for (const example of ['basic-agent', 'policy', 'idempotency', 'tool-adapter']) {
    const { stdout } = await exec(process.execPath, [path.join('examples', example, 'run.mjs')], { cwd: consumer, env });
    const summary = JSON.parse(stdout);
    if (summary.example !== example) throw new Error(`Example ${example} did not report its result.`);
    process.stdout.write(`${stdout.trim()}\n`);
  }

  const agent = new sdk.ShlitaAgentClient({ apiKey: issued.apiKey, baseUrl });
  await operator.freezeAgent('research-agent', 'consumer-check');
  const frozen = await agent.proxy({
    agentId: 'research-agent',
    vendor: 'api.helius.xyz',
    path: '/v0/token-metadata',
    idempotencyKey: 'consumer-after-freeze',
    simulate: true,
  });
  if (frozen.outcome !== 'rejected' || frozen.reason !== 'AGENT_FROZEN') {
    throw new Error('A frozen agent was still allowed to spend.');
  }
  const before = await operator.listOperations();
  const committed = before.operations.find((row) => row.reservedAmountMicroUsdc === '10000' && row.state === 'ACCOUNTING_COMMITTED' && row.signature === null);
  if (!committed) throw new Error('The ledger did not record the simulated reservation.');

  await stopGateway(gateway);
  gateway = startGateway(port, logPath);
  await waitReady(baseUrl, gateway, logPath);
  const reopened = new sdk.ShlitaOperatorClient({ operatorKey, baseUrl });
  const after = await reopened.listOperations();
  const restored = after.operations.find((row) => row.operationId === committed.operationId);
  if (restored?.reservedAmountMicroUsdc !== '10000' || restored.signature !== null) {
    throw new Error('The reservation did not survive the gateway restart.');
  }
  const agents = await reopened.listAgents();
  if (agents.agents.find((row) => row.agentId === 'research-agent')?.status !== 'AGENT_FROZEN') {
    throw new Error('The frozen agent did not survive the gateway restart.');
  }
  const anonymous = await fetch(`${baseUrl}/v1/agents`);
  if (anonymous.status !== 401) throw new Error('Anonymous agent listing was not rejected.');

  const logs = fs.readFileSync(logPath, 'utf8');
  if (logs.includes(operatorKey) || logs.includes(issued.apiKey)) {
    throw new Error('Gateway logs contain a credential.');
  }
  console.log(JSON.stringify({
    installed: true,
    compiled: true,
    examples: 4,
    restart: 'preserved',
    operationId: committed.operationId,
    reservedAmountMicroUsdc: '10000',
  }));
} finally {
  await stopGateway(gateway);
  fs.rmSync(work, { recursive: true, force: true });
}
