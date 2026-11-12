import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPolicyEngine } from '../packages/core/src/index.js';
import { createGatewayApp } from '../packages/gateway/src/app.js';

const SPEC = fs.readFileSync(new URL('../docs/api/openapi.yaml', import.meta.url), 'utf8');

function documentedOperations(spec: string): Array<{ method: string; path: string }> {
  const operations: Array<{ method: string; path: string }> = [];
  let path = '';
  let inPaths = false;
  for (const line of spec.split('\n')) {
    if (line.startsWith('paths:')) {
      inPaths = true;
      continue;
    }
    if (inPaths && /^[a-z]/.test(line)) break;
    const pathMatch = line.match(/^  (\/[^:]+):/);
    if (pathMatch) {
      path = pathMatch[1]!;
      continue;
    }
    const methodMatch = line.match(/^    (get|post|put|patch|delete):/);
    if (path && methodMatch) operations.push({ method: methodMatch[1]!.toUpperCase(), path });
  }
  return operations;
}

describe('OpenAPI contract', () => {
  it('lists the same routes the gateway registers', () => {
    const engine = createPolicyEngine();
    const app = createGatewayApp(engine, undefined, {
      operators: [{ key: 'o'.repeat(40), ownerOrg: 'org-contract' }],
    });
    const implemented = app.routes
      .filter((route) => route.path.startsWith('/v1') || route.path === '/health' || route.path === '/ready' || route.path === '/metrics')
      .map((route) => `${route.method} ${route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')}`)
      .sort();
    const documented = documentedOperations(SPEC).map((operation) => `${operation.method} ${operation.path}`).sort();
    expect(documented).toEqual(implemented);
    engine.close();
  });

  it('requires operator or agent authentication on the documented private routes', async () => {
    const engine = createPolicyEngine();
    const app = createGatewayApp(engine, undefined, {
      operators: [{ key: 'o'.repeat(40), ownerOrg: 'org-contract' }],
    });
    const samples: Record<string, string> = {
      '{id}': 'agent-contract',
      '{operationId}': 'op-missing',
    };
    for (const operation of documentedOperations(SPEC)) {
      const path = operation.path.replace(/\{[^}]+\}/g, (token) => samples[token] ?? 'missing');
      const response = await app.request(path, {
        method: operation.method,
        headers: { 'content-type': 'application/json' },
        body: operation.method === 'GET' ? undefined : '{}',
      });
      if (operation.path === '/health' || operation.path === '/ready' || operation.path === '/metrics') {
        expect(response.status, operation.path).toBe(200);
      } else if (operation.path === '/v1/session/logout') {
        expect(response.status).toBe(200);
      } else {
        expect(response.status, `${operation.method} ${operation.path}`).toBe(401);
      }
      const text = await response.text();
      expect(text).not.toContain('o'.repeat(40));
    }
    engine.close();
  });
});
