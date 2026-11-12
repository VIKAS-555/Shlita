import crypto from 'node:crypto';

export interface OperatorSession {
  id: string;
  organizationId: string;
  csrfToken: string;
  expiresAt: number;
}

interface StoredSession extends OperatorSession {}

/**
 * Short-lived operator sessions. The long-lived operator key is checked once
 * at login and is not stored in the session or sent back to the browser.
 */
export class OperatorSessionStore {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly failures = new Map<string, number[]>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxFailures: number;
  private readonly windowMs: number;

  constructor(options: { now?: () => number; ttlMs?: number; maxFailures?: number; windowMs?: number } = {}) {
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? 15 * 60 * 1000;
    this.maxFailures = options.maxFailures ?? 8;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000;
  }

  limited(client: string): boolean {
    this.pruneFailures(client);
    return (this.failures.get(client)?.length ?? 0) >= this.maxFailures;
  }

  recordFailure(client: string): void {
    this.pruneFailures(client);
    const rows = this.failures.get(client) ?? [];
    rows.push(this.now());
    this.failures.set(client, rows);
  }

  clearFailures(client: string): void {
    this.failures.delete(client);
  }

  open(organizationId: string): OperatorSession {
    const session: StoredSession = {
      id: crypto.randomBytes(32).toString('hex'),
      organizationId,
      csrfToken: crypto.randomBytes(32).toString('hex'),
      expiresAt: this.now() + this.ttlMs,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  readCookie(cookieHeader: string | undefined): OperatorSession | null {
    const id = readCookieValue(cookieHeader, 'shlita_session');
    if (!id) return null;
    const session = this.sessions.get(id);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }

  csrfOk(sessionId: string, presented: string | undefined): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !presented) return false;
    const left = Buffer.from(session.csrfToken);
    const right = Buffer.from(presented);
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  }

  close(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private pruneFailures(client: string): void {
    const rows = this.failures.get(client);
    if (!rows) return;
    const cutoff = this.now() - this.windowMs;
    const kept = rows.filter((at) => at >= cutoff);
    if (kept.length === 0) this.failures.delete(client);
    else this.failures.set(client, kept);
  }
}

export function sessionCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [
    `shlita_session=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function readCookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName === name) return rest.join('=');
  }
  return null;
}
