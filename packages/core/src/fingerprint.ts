import crypto from 'node:crypto';

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
}

/**
 * Identity of a billable request. The client-supplied price is intentionally absent:
 * a retry that only changes the claimed cost is the same operation, and a changed
 * vendor, method, path, or body is not.
 */
export function requestFingerprint(input: {
  agentId: string;
  vendorHost: string;
  method: string;
  path: string;
  body: unknown;
}): string {
  const material = canonicalJson({
    agentId: input.agentId,
    vendorHost: input.vendorHost.trim().toLowerCase(),
    method: input.method.trim().toUpperCase(),
    path: input.path,
    body: input.body ?? null,
  });
  return crypto.createHash('sha256').update(material).digest('hex');
}
