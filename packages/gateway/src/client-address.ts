const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function normalizeAddress(value: string | undefined): string | null {
  if (!value) return null;
  let address = value.trim();
  if (address.startsWith('::ffff:')) address = address.slice('::ffff:'.length);
  if (IPV4.test(address)) return address;
  if (address === '::1' || (address.includes(':') && /^[0-9a-f:]+$/i.test(address))) return address.toLowerCase();
  return null;
}

function ipv4ToInt(ip: string): number | null {
  if (!IPV4.test(ip)) return null;
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function isTrustedProxy(peer: string, trustedProxies: readonly string[]): boolean {
  const normalizedPeer = normalizeAddress(peer);
  if (!normalizedPeer) return false;
  for (const item of trustedProxies) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed.includes('/')) {
      const [range, bitsStr] = trimmed.split('/');
      const bits = Number(bitsStr);
      if (Number.isInteger(bits) && bits >= 0 && bits <= 32) {
        const netInt = ipv4ToInt(range);
        const ipInt = ipv4ToInt(normalizedPeer);
        if (netInt !== null && ipInt !== null) {
          const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
          if ((ipInt & mask) === (netInt & mask)) return true;
        }
      }
    } else {
      const normalizedItem = normalizeAddress(trimmed);
      if (normalizedItem && normalizedItem === normalizedPeer) return true;
    }
  }
  return false;
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
  if (!isTrustedProxy(peer, input.trustedProxies)) return peer;

  const hops = (input.forwardedFor ?? '')
    .split(',')
    .map((hop) => normalizeAddress(hop))
    .filter((hop): hop is string => Boolean(hop));
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    if (!isTrustedProxy(hops[index], input.trustedProxies)) return hops[index];
  }
  const real = normalizeAddress(input.realIp);
  if (real && !isTrustedProxy(real, input.trustedProxies)) return real;
  return peer;
}
