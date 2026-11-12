/**
 * Startup security checks. Production refuses to boot unless operator
 * configuration is explicit and strong. Development may generate a local
 * operator key outside the repository's tracked files; it never falls back
 * to a published credential.
 *
 * One operator key belongs to one organization. That is the whole access
 * model in this step: operator versus agent, scoped by owner org.
 */

const MIN_OPERATOR_KEY_LENGTH = 32;

const REJECTED_CREDENTIALS = new Set([
  'shlt_operator_master',
  'shlt_live_researcher_dev_01',
  'shlt_live_arbitrage_dev_02',
  'shlt_live_sentinel_dev_01',
  'replace-with-at-least-32-random-characters',
  'password',
  'secret',
  'changeme',
  'admin',
]);

const KNOWN_MODES = new Set(['development', 'test', 'staging', 'production']);

export interface SecurityConfig {
  production: boolean;
  mode: 'development' | 'test' | 'staging' | 'production';
  locked: boolean;
  operatorKey: string;
  operatorOrg: string;
  generateOperatorKey: boolean;
  allowSimulation: boolean;
  seedDemo: boolean;
  corsOrigins: string[];
  trustedProxies: string[];
  publicOrigin?: string;
  secureCookies: boolean;
  logLevel: string;
  backupDir?: string;
  backupRetention: number;
  dbPath?: string;
  stateDir: string;
  port: number;
  demoKeyResearcher?: string;
  demoKeyArbitrage?: string;
}

export type SecurityAssessment =
  | { ok: true; config: SecurityConfig }
  | { ok: false; errors: string[] };

export function assessSecurityConfig(
  env: Record<string, string | undefined>
): SecurityAssessment {
  const mode = (env.SHLITA_ENV || env.NODE_ENV || 'development').toLowerCase();
  const errors: string[] = [];
  if (!KNOWN_MODES.has(mode)) {
    return { ok: false, errors: [`SHLITA_ENV must be development, test, staging, or production.`] };
  }
  const production = mode === 'production';
  const locked = mode === 'production' || mode === 'staging';

  const operatorKey = env.SHLITA_OPERATOR_KEY?.trim() ?? '';
  const operatorOrg = env.SHLITA_OPERATOR_ORG?.trim() ?? '';
  const allowSimulation = env.SHLITA_ALLOW_SIMULATION === 'true';
  const seedDemo = env.SHLITA_SEED_DEMO === 'true';
  const corsOrigins = (env.SHLITA_CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const demoKeyResearcher = env.SHLITA_DEMO_KEY_RESEARCHER?.trim() || undefined;
  const demoKeyArbitrage = env.SHLITA_DEMO_KEY_ARBITRAGE?.trim() || undefined;
  const dbPath = env.SHLITA_DB_PATH?.trim() || undefined;
  const trustedProxies = (env.SHLITA_TRUSTED_PROXIES ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const publicOrigin = env.SHLITA_PUBLIC_ORIGIN?.trim() || undefined;
  const backupDir = env.SHLITA_BACKUP_DIR?.trim() || undefined;
  const retentionText = env.SHLITA_BACKUP_RETENTION?.trim();
  const backupRetention = retentionText ? Number(retentionText) : 14;
  const portText = env.PORT?.trim();
  const port = portText ? Number(portText) : 4000;

  if (corsOrigins.includes('*')) {
    errors.push('Wildcard CORS origins are not permitted.');
  }

  if (operatorKey && !isAcceptableSecret(operatorKey, MIN_OPERATOR_KEY_LENGTH)) {
    errors.push('SHLITA_OPERATOR_KEY does not meet strength requirements.');
  }
  for (const [name, value] of [
    ['SHLITA_DEMO_KEY_RESEARCHER', demoKeyResearcher],
    ['SHLITA_DEMO_KEY_ARBITRAGE', demoKeyArbitrage],
  ] as const) {
    if (value && !isAcceptableSecret(value, 16)) {
      errors.push(`${name} uses a rejected or too-short credential.`);
    }
  }

  if (locked) {
    if (!operatorKey) errors.push('SHLITA_OPERATOR_KEY is required in production.');
    if (!operatorOrg) errors.push('SHLITA_OPERATOR_ORG is required in production.');
    if (allowSimulation) errors.push('Simulation cannot be enabled in production.');
    if (seedDemo) errors.push('Demo enrollment cannot run in production.');
    if (!dbPath || dbPath === ':memory:') errors.push('SHLITA_DB_PATH must be a persistent file in production.');
    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('PORT must be an integer from 1 to 65535.');
    if (publicOrigin && !publicOrigin.startsWith('https://')) {
      errors.push('SHLITA_PUBLIC_ORIGIN must use HTTPS in production.');
    }
    if (trustedProxies.some((proxy) => proxy === 'local' || proxy === '*')) {
      errors.push('SHLITA_TRUSTED_PROXIES cannot include local or a wildcard in production.');
    }
    if (!Number.isInteger(backupRetention) || backupRetention < 1 || backupRetention > 365) {
      errors.push('SHLITA_BACKUP_RETENTION must be an integer from 1 to 365.');
    }
  } else if (operatorKey && !operatorOrg) {
    errors.push('SHLITA_OPERATOR_ORG is required when SHLITA_OPERATOR_KEY is set.');
  }

  if (errors.length > 0) return { ok: false, errors };

  const devOrigins =
    corsOrigins.length > 0 ? corsOrigins : ['http://localhost:5173', 'http://127.0.0.1:5173'];

  return {
    ok: true,
    config: {
      production,
      mode: mode as SecurityConfig['mode'],
      locked,
      operatorKey,
      operatorOrg: operatorOrg || 'org-local',
      generateOperatorKey: !locked && !operatorKey,
      allowSimulation: locked ? false : allowSimulation,
      seedDemo: locked ? false : seedDemo,
      corsOrigins: locked ? corsOrigins : devOrigins,
      trustedProxies,
      publicOrigin,
      secureCookies: locked,
      logLevel: env.SHLITA_LOG_LEVEL?.trim() || 'info',
      backupDir,
      backupRetention: Number.isInteger(backupRetention) ? backupRetention : 14,
      dbPath,
      stateDir: env.SHLITA_STATE_DIR?.trim() || '.shlita',
      port: Number.isInteger(port) && port > 0 ? port : 4000,
      demoKeyResearcher,
      demoKeyArbitrage,
    },
  };
}

function isAcceptableSecret(value: string, minLength: number): boolean {
  if (value.length < minLength || value.length > 256) return false;
  if (REJECTED_CREDENTIALS.has(value.toLowerCase())) return false;
  return true;
}
