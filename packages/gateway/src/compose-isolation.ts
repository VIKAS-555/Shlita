import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROTECTED_STAGING_RESOURCES = [
  'shlita-staging-gateway',
  'shlita-staging-caddy',
  'shlita-staging-backup-worker',
  'shlita-staging-data',
  'shlita-staging-external-backups',
  'shlita-staging-caddy-data',
  'shlita-staging-caddy-config',
  'shlita-staging-net',
] as const;

export interface ComposeIsolationResult {
  safe: boolean;
  violations: string[];
  resolvedResources: {
    containers: string[];
    volumes: string[];
    networks: string[];
  };
}

/**
 * Validates that a resolved Docker Compose configuration is fully isolated
 * and does not point to any protected staging containers, volumes, or networks.
 */
export function validateComposeIsolation(
  yamlContent: string,
  projectName?: string
): ComposeIsolationResult {
  const violations: string[] = [];
  const containers: string[] = [];
  const volumes: string[] = [];
  const networks: string[] = [];

  // Match container_name: <name>
  const containerMatches = yamlContent.matchAll(/^\s*container_name:\s*["']?([^"'\s#]+)["']?/gm);
  for (const match of containerMatches) {
    if (match[1]) containers.push(match[1]);
  }

  // Parse volume names and network names
  // In Docker Compose config output, top-level volumes and networks have:
  // volumes:\n  <vol_key>:\n    name: <vol_name>
  // networks:\n  <net_key>:\n    name: <net_name>
  const nameMatches = yamlContent.matchAll(/^\s*name:\s*["']?([^"'\s#]+)["']?/gm);
  for (const match of nameMatches) {
    const val = match[1];
    if (val && !containers.includes(val)) {
      // If val is not already recorded as a container
      if (val.includes('net') || val.includes('network')) {
        networks.push(val);
      } else {
        volumes.push(val);
      }
    }
  }

  // Check 1: No protected staging resource names may appear
  for (const protectedName of PROTECTED_STAGING_RESOURCES) {
    // Check if the protected resource name appears in containers, volumes, or networks
    if (
      containers.includes(protectedName) ||
      volumes.includes(protectedName) ||
      networks.includes(protectedName) ||
      yamlContent.includes(`"${protectedName}"`) ||
      yamlContent.includes(`'${protectedName}'`) ||
      new RegExp(`\\b${protectedName}\\b`).test(yamlContent)
    ) {
      violations.push(`Configuration references protected staging resource: ${protectedName}`);
    }
  }

  // Check 2: No resource name matching shlita-staging- wildcard
  const allResources = [...containers, ...volumes, ...networks];
  for (const res of allResources) {
    if (res.startsWith('shlita-staging-') && !violations.some((v) => v.includes(res))) {
      violations.push(`Resource '${res}' matches protected staging pattern 'shlita-staging-*'`);
    }
  }

  // Check 3: If projectName is specified, all containers and volumes must be scoped to projectName
  if (projectName) {
    for (const c of containers) {
      if (!c.startsWith(projectName)) {
        violations.push(`Container '${c}' is not scoped to project '${projectName}'`);
      }
    }
    for (const v of volumes) {
      if (!v.startsWith(projectName)) {
        violations.push(`Volume '${v}' is not scoped to project '${projectName}'`);
      }
    }
  }

  return {
    safe: violations.length === 0,
    violations,
    resolvedResources: {
      containers,
      volumes,
      networks,
    },
  };
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectExecution()) {
  const targetFile = process.argv[2];
  const targetProject = process.argv[3];

  let content = '';
  if (targetFile && targetFile !== '-') {
    content = fs.readFileSync(targetFile, 'utf-8');
  } else {
    content = fs.readFileSync(0, 'utf-8');
  }

  const result = validateComposeIsolation(content, targetProject);
  if (!result.safe) {
    console.error('FATAL: Compose isolation validation failed:');
    for (const v of result.violations) {
      console.error(`- ${v}`);
    }
    process.exit(1);
  }

  console.log('PASS: Compose configuration is safely isolated.');
  console.log(
    `Containers: ${result.resolvedResources.containers.join(', ') || 'none (default scoped)'}`
  );
  console.log(
    `Volumes: ${result.resolvedResources.volumes.join(', ') || 'none (default scoped)'}`
  );
  process.exit(0);
}
