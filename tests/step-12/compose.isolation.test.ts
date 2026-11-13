import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  validateComposeIsolation,
  PROTECTED_STAGING_RESOURCES,
} from '../../packages/gateway/src/compose-isolation.js';

describe('Step 12 — Docker Compose Test Isolation & Resource Safety', () => {
  it('declares parameterized container, volume, and network names with safe staging defaults', () => {
    const composeContent = fs.readFileSync(path.resolve('compose.staging.yaml'), 'utf-8');

    // Container parameterization
    expect(composeContent).toContain('${SHLITA_GATEWAY_CONTAINER:-shlita-staging-gateway}');
    expect(composeContent).toContain('${SHLITA_BACKUP_CONTAINER:-shlita-staging-backup-worker}');
    expect(composeContent).toContain('${SHLITA_CADDY_CONTAINER:-shlita-staging-caddy}');

    // Volume parameterization
    expect(composeContent).toContain('${SHLITA_DATA_VOLUME:-shlita-staging-data}');
    expect(composeContent).toContain('${SHLITA_BACKUPS_VOLUME:-shlita-staging-external-backups}');
    expect(composeContent).toContain('${SHLITA_CADDY_DATA_VOLUME:-shlita-staging-caddy-data}');
    expect(composeContent).toContain('${SHLITA_CADDY_CONFIG_VOLUME:-shlita-staging-caddy-config}');

    // Network parameterization
    expect(composeContent).toContain('${SHLITA_NETWORK:-shlita-staging-net}');
  });

  it('fails closed when resolved configuration points to protected staging resources', () => {
    const rawStagingConfig = `
services:
  gateway:
    container_name: shlita-staging-gateway
  backup-worker:
    container_name: shlita-staging-backup-worker
volumes:
  shlita-data:
    name: shlita-staging-data
  shlita-external-backups:
    name: shlita-staging-external-backups
networks:
  shlita-net:
    name: shlita-staging-net
`;
    const result = validateComposeIsolation(rawStagingConfig, 'test-project-123');
    expect(result.safe).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(4);

    // Explicitly flags staging resources
    expect(
      result.violations.some((v) => v.includes('shlita-staging-gateway'))
    ).toBe(true);
    expect(
      result.violations.some((v) => v.includes('shlita-staging-data'))
    ).toBe(true);
  });

  it('passes validation when all resources are uniquely scoped to the verification project', () => {
    const projectName = 'shlita-verify-test-8899';
    const isolatedConfig = `
services:
  gateway:
    container_name: ${projectName}-gateway
  backup-worker:
    container_name: ${projectName}-backup-worker
volumes:
  shlita-data:
    name: ${projectName}-data
  shlita-external-backups:
    name: ${projectName}-backups
networks:
  shlita-net:
    name: ${projectName}-net
`;
    const result = validateComposeIsolation(isolatedConfig, projectName);
    expect(result.safe).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.resolvedResources.containers).toEqual([
      `${projectName}-gateway`,
      `${projectName}-backup-worker`,
    ]);
    expect(result.resolvedResources.volumes).toEqual([
      `${projectName}-data`,
      `${projectName}-backups`,
    ]);
  });

  it('fails closed if even a single volume is unisolated or matches staging patterns', () => {
    const projectName = 'shlita-verify-test-555';
    const partiallyIsolatedConfig = `
services:
  gateway:
    container_name: ${projectName}-gateway
  backup-worker:
    container_name: ${projectName}-backup-worker
volumes:
  shlita-data:
    name: ${projectName}-data
  shlita-external-backups:
    name: shlita-staging-external-backups
`;
    const result = validateComposeIsolation(partiallyIsolatedConfig, projectName);
    expect(result.safe).toBe(false);
    expect(
      result.violations.some((v) => v.includes('shlita-staging-external-backups'))
    ).toBe(true);
  });

  it('fails closed if container name is not prefixed by project name', () => {
    const projectName = 'shlita-verify-test-111';
    const rogueContainerConfig = `
services:
  gateway:
    container_name: another-project-gateway
volumes:
  shlita-data:
    name: ${projectName}-data
`;
    const result = validateComposeIsolation(rogueContainerConfig, projectName);
    expect(result.safe).toBe(false);
    expect(result.violations.some((v) => v.includes('another-project-gateway'))).toBe(true);
  });

  it('ensures all protected staging resource constants are defined and unique', () => {
    expect(PROTECTED_STAGING_RESOURCES.length).toBe(8);
    const set = new Set(PROTECTED_STAGING_RESOURCES);
    expect(set.size).toBe(PROTECTED_STAGING_RESOURCES.length);
  });
});
