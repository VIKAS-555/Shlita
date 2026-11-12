const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function normalizeAddress(value: string | undefined): string | null {
  if (!value) return null;
  let address = value.trim();
  if (address.startsWith('::ffff:')) address = address.slice('::ffff:'.length);
  if (IPV4.test(address)) return address;
  if (address === '::1' || (address.includes(':') && /^[0-9a-f:]+$/i.test(address))) return address.toLowerCase();
  return null;
}

/**
 * Forwarded headers are client-controlled unless the immediate peer is a
 * proxy this process was explicitly configured to trust.
 */
export function clientIdentity(input: {
  remoteAddress?: string;
  forwardedFor?: string;
  realIp?: string;
  trustedProxies: readonly string[];
}): string {
  const peer = normalizeAddress(input.remoteAddress) ?? 'local';
  const trusted = new Set(input.trustedProxies.map((item) => normalizeAddress(item) ?? item));
  if (!trusted.has(peer)) return peer;

  const hops = (input.forwardedFor ?? '')
    .split(',')
    .map((hop) => normalizeAddress(hop))
    .filter((hop): hop is string => Boolean(hop));
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    if (!trusted.has(hops[index])) return hops[index];
  }
  const real = normalizeAddress(input.realIp);
  if (real && !trusted.has(real)) return real;
  return peer;
}
