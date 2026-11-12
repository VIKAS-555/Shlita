import { describe, expect, it } from 'vitest';
import { clientIdentity } from '../packages/gateway/src/client-address.js';

describe('client identity behind a proxy', () => {
  it('ignores forwarded headers from a direct client', () => {
    const identity = clientIdentity({
      remoteAddress: '203.0.113.10',
      forwardedFor: '1.1.1.1, 2.2.2.2',
      realIp: '9.9.9.9',
      trustedProxies: [],
    });
    expect(identity).toBe('203.0.113.10');
  });

  it('uses the rightmost untrusted hop when the peer is a trusted proxy', () => {
    const identity = clientIdentity({
      remoteAddress: '10.0.0.5',
      forwardedFor: '1.1.1.1, 198.51.100.20',
      realIp: undefined,
      trustedProxies: ['10.0.0.5'],
    });
    expect(identity).toBe('198.51.100.20');
  });
});
