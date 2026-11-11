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

export interface SecurityConfig {
  production: boolean;
  operatorKey: string;
  operatorOrg: string;
  generateOperatorKey: boolean;
  allowSimulation: boolean;
  seedDemo: boolean;
  corsOrigins: string[];
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
  const production = mode === 'production';
  const errors: string[] = [];

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

  if (production) {
    if (!operatorKey) errors.push('SHLITA_OPERATOR_KEY is required in production.');
    if (!operatorOrg) errors.push('SHLITA_OPERATOR_ORG is required in production.');
    if (allowSimulation) errors.push('Simulation cannot be enabled in production.');
    if (seedDemo) errors.push('Demo enrollment cannot run in production.');
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
      operatorKey,
      operatorOrg: operatorOrg || 'org-local',
      generateOperatorKey: !production && !operatorKey,
      allowSimulation: production ? false : allowSimulation,
      seedDemo: production ? false : seedDemo,
      corsOrigins: production ? corsOrigins : devOrigins,
      dbPath: env.SHLITA_DB_PATH?.trim() || undefined,
      stateDir: env.SHLITA_STATE_DIR?.trim() || '.shlita',
      port: Number(env.PORT) || 4000,
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
