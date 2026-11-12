import crypto from 'node:crypto';

export interface OperatorSession {
  id: string;
  organizationId: string;
  csrfToken: string;
  expiresAt: number;
}

export interface AttemptStore {
  count(kind: string, client: string, since: number): number;
  add(kind: string, client: string, at: number): void;
  clear(kind: string, client: string): void;
}

interface StoredSession extends OperatorSession {}

/**
 * Short-lived operator sessions. The long-lived operator key is checked once
 * at login and is not stored in the session or sent back to the browser.
 * Session rows are process-local. A restart requires a new sign-in.
 * Login attempts can use a durable store so a restart does not clear a lockout.
 */
export class OperatorSessionStore {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly failures = new Map<string, number[]>();
  private readonly mutations = new Map<string, number[]>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxFailures: number;
  private readonly maxMutations: number;
  private readonly windowMs: number;
  private readonly rateStore?: AttemptStore;

  constructor(
    options: {
      now?: () => number;
      ttlMs?: number;
      maxFailures?: number;
      maxMutations?: number;
      windowMs?: number;
      rateStore?: AttemptStore;
    } = {}
  ) {
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? 15 * 60 * 1000;
    this.maxFailures = options.maxFailures ?? 8;
    this.maxMutations = options.maxMutations ?? 60;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000;
    this.rateStore = options.rateStore;
  }

  limited(client: string): boolean {
    return this.count('login', client, this.failures) >= this.maxFailures;
  }

  recordFailure(client: string): void {
    this.add('login', client, this.failures);
  }

  clearFailures(client: string): void {
    if (this.rateStore) this.rateStore.clear('login', client);
    this.failures.delete(client);
  }

  mutationLimited(client: string): boolean {
    return this.count('mutate', client, this.mutations) >= this.maxMutations;
  }

  recordMutation(client: string): void {
    this.add('mutate', client, this.mutations);
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
    this.sweepExpired();
    const id = readCookieValue(cookieHeader, 'shlita_session');
    if (!id) return null;
    const session = this.sessions.get(id);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(id);
      return null;
    }
    if (session.expiresAt - this.now() < this.ttlMs / 3) {
      session.expiresAt = this.now() + this.ttlMs;
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

  private count(kind: string, client: string, memory: Map<string, number[]>): number {
    const since = this.now() - this.windowMs;
    if (this.rateStore) return this.rateStore.count(kind, client, since);
    this.prune(memory, client, since);
    return memory.get(client)?.length ?? 0;
  }

  private add(kind: string, client: string, memory: Map<string, number[]>): void {
    const at = this.now();
    if (this.rateStore) {
      this.rateStore.add(kind, client, at);
      return;
    }
    const since = at - this.windowMs;
    this.prune(memory, client, since);
    const rows = memory.get(client) ?? [];
    rows.push(at);
    memory.set(client, rows);
  }

  private sweepExpired(): void {
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= this.now()) this.sessions.delete(id);
    }
  }

  private prune(memory: Map<string, number[]>, client: string, since: number): void {
    const rows = memory.get(client);
    if (!rows) return;
    const kept = rows.filter((at) => at >= since);
    if (kept.length === 0) memory.delete(client);
    else memory.set(client, kept);
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
