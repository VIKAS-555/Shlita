import crypto from 'node:crypto';

/**
 * Single-organization operator boundary.
 * One operator credential maps to one owner org. Agent credentials never
 * grant operator actions. This is not multi-role enterprise RBAC.
 */

const CREDENTIAL_PATTERN = /^[A-Za-z0-9._~+-]{16,256}$/;

export interface OperatorCredential {
  key: string;
  ownerOrg: string;
}

export interface GatewaySecurityOptions {
  operators?: OperatorCredential[];
  allowSimulation?: boolean;
  corsOrigins?: string[];
  maxJsonBytes?: number;
}

export interface AgentPrincipal {
  agentId: string;
  ownerOrg: string;
}

type HeaderSource = { header(name: string): string | undefined };

export function applyCors(
  setHeader: (name: string, value: string) => void,
  origin: string | undefined,
  allowedOrigins: readonly string[]
): void {
  if (!origin || !allowedOrigins.includes(origin)) return;
  setHeader('Access-Control-Allow-Origin', origin);
  setHeader('Vary', 'Origin');
  setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, x-shlita-api-key, x-shlita-operator-key, x-shlita-simulation'
  );
  setHeader('Access-Control-Max-Age', '600');
}

export async function readJsonObject(
  request: Request,
  maxBytes: number
): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; status: 400 | 413; body: { error: string; message: string } }
> {
  const declared = request.headers.get('content-length');
  if (declared && Number.isFinite(Number(declared)) && Number(declared) > maxBytes) {
    return {
      ok: false,
      status: 413,
      body: { error: 'PAYLOAD_TOO_LARGE', message: 'Payload too large.' },
    };
  }

  const text = await request.text();
  if (text.length > maxBytes) {
    return {
      ok: false,
      status: 413,
      body: { error: 'PAYLOAD_TOO_LARGE', message: 'Payload too large.' },
    };
  }
  if (!text.trim()) return { ok: true, value: {} };

  try {
    const value = JSON.parse(text) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return {
        ok: false,
        status: 400,
        body: { error: 'BAD_REQUEST', message: 'Malformed JSON payload.' },
      };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      status: 400,
      body: { error: 'BAD_REQUEST', message: 'Malformed JSON payload.' },
    };
  }
}

function unauthorized(message = 'Authentication required.') {
  return {
    ok: false as const,
    status: 401 as const,
    body: { allowed: false as const, error: 'UNAUTHORIZED', message },
  };
}

export function resolveAgentPrincipal(
  source: HeaderSource,
  authenticate: (token: string) => AgentPrincipal | null
):
  | { ok: true; principal: AgentPrincipal }
  | { ok: false; status: 401; body: { allowed: false; error: string; message: string } } {
  const apiKey = source.header('x-shlita-api-key')?.trim() ?? '';
  const authorization = source.header('authorization')?.trim() ?? '';

  if (!apiKey && !authorization) return unauthorized();

  let bearerToken = '';
  if (authorization) {
    const separator = authorization.indexOf(' ');
    if (separator <= 0) return unauthorized();
    const scheme = authorization.slice(0, separator);
    const rest = authorization.slice(separator + 1).trim();
    if (!/^Bearer$/i.test(scheme)) {
      return unauthorized('Unsupported authentication scheme.');
    }
    if (!rest || /\s/.test(rest)) return unauthorized();
    bearerToken = rest;
  }

  let token = bearerToken;
  if (apiKey) {
    if (bearerToken && bearerToken !== apiKey) return unauthorized();
    token = apiKey;
  }

  if (!CREDENTIAL_PATTERN.test(token)) return unauthorized();

  const principal = authenticate(token);
  if (!principal) return unauthorized();
  return { ok: true, principal };
}

export function assertMatchingAgent(
  requested: unknown,
  authenticatedAgentId: string
):
  | { ok: true; agentId: string }
  | { ok: false; status: 400 | 403; body: { allowed: false; error: string; message: string } } {
  if (requested == null || requested === '') {
    return { ok: true, agentId: authenticatedAgentId };
  }
  if (typeof requested !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(requested)) {
    return {
      ok: false,
      status: 400,
      body: { allowed: false, error: 'BAD_REQUEST', message: 'Invalid agent identity.' },
    };
  }
  if (requested !== authenticatedAgentId) {
    return {
      ok: false,
      status: 403,
      body: {
        allowed: false,
        error: 'IDENTITY_MISMATCH',
        message: 'Authenticated identity does not match the requested agent.',
      },
    };
  }
  return { ok: true, agentId: authenticatedAgentId };
}

export function simulationRequested(
  body: Record<string, unknown>,
  simulationHeader: string | undefined
): boolean {
  return body.simulate === true || simulationHeader === 'true';
}

export function resolveOperator(
  source: HeaderSource,
  operators: readonly OperatorCredential[]
): { ok: true; ownerOrg: string } | { ok: false; status: 401 | 403 } {
  const presented = source.header('x-shlita-operator-key')?.trim() ?? '';
  if (!presented) return { ok: false, status: 401 };
  if (presented.length > 256) return { ok: false, status: 401 };

  let ownerOrg: string | null = null;
  for (const operator of operators) {
    if (safeEqual(presented, operator.key)) {
      ownerOrg = operator.ownerOrg;
      break;
    }
  }
  if (!ownerOrg) return { ok: false, status: 403 };
  return { ok: true, ownerOrg };
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
