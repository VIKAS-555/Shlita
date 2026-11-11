import { describe, it, expect } from 'vitest';
import { assessSecurityConfig } from '../packages/gateway/src/security-config.js';

const STRONG = 'c'.repeat(48);

describe('production security configuration', () => {
  it('fails closed when production configuration is missing or unsafe', () => {
    expect(assessSecurityConfig({ SHLITA_ENV: 'production' }).ok).toBe(false);
    expect(
      assessSecurityConfig({
        SHLITA_ENV: 'production',
        SHLITA_OPERATOR_KEY: 'shlt_operator_master',
        SHLITA_OPERATOR_ORG: 'org-example',
      }).ok
    ).toBe(false);
    expect(
      assessSecurityConfig({
        SHLITA_ENV: 'production',
        SHLITA_OPERATOR_KEY: 'shlt_live_researcher_dev_01',
        SHLITA_OPERATOR_ORG: 'org-example',
      }).ok
    ).toBe(false);
    expect(
      assessSecurityConfig({
        SHLITA_ENV: 'production',
        SHLITA_OPERATOR_KEY: STRONG,
        SHLITA_OPERATOR_ORG: 'org-example',
        SHLITA_ALLOW_SIMULATION: 'true',
      }).ok
    ).toBe(false);
    expect(
      assessSecurityConfig({
        SHLITA_ENV: 'production',
        SHLITA_OPERATOR_KEY: STRONG,
        SHLITA_OPERATOR_ORG: 'org-example',
        SHLITA_SEED_DEMO: 'true',
      }).ok
    ).toBe(false);
    expect(
      assessSecurityConfig({
        SHLITA_ENV: 'production',
        SHLITA_OPERATOR_KEY: STRONG,
        SHLITA_OPERATOR_ORG: 'org-example',
        SHLITA_CORS_ORIGINS: '*',
      }).ok
    ).toBe(false);
  });

  it('accepts a strong production configuration with simulation and demo enrollment off', () => {
    const result = assessSecurityConfig({
      SHLITA_ENV: 'production',
      SHLITA_OPERATOR_KEY: STRONG,
      SHLITA_OPERATOR_ORG: 'org-example',
      SHLITA_CORS_ORIGINS: 'https://shlita.example',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.allowSimulation).toBe(false);
    expect(result.config.seedDemo).toBe(false);
    expect(result.config.corsOrigins).toEqual(['https://shlita.example']);
    expect(result.config.generateOperatorKey).toBe(false);
  });

  it('accepts an explicit local demo configuration', () => {
    const result = assessSecurityConfig({
      SHLITA_ENV: 'development',
      SHLITA_OPERATOR_KEY: STRONG,
      SHLITA_OPERATOR_ORG: 'org-demo',
      SHLITA_ALLOW_SIMULATION: 'true',
      SHLITA_SEED_DEMO: 'true',
      SHLITA_DEMO_KEY_RESEARCHER: 'shlt_test_local_researcher_key',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.allowSimulation).toBe(true);
    expect(result.config.seedDemo).toBe(true);
    expect(result.config.demoKeyResearcher).toBe('shlt_test_local_researcher_key');
  });
});
