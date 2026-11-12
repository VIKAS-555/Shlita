import { ShlitaApiError, ShlitaClientError, ShlitaUncertainError } from './errors.js';

const CREDENTIAL = /^[A-Za-z0-9._~+-]{16,256}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._~:-]{8,200}$/;
const MICRO_USDC = /^(0|[1-9][0-9]*)$/;
const REQUEST_ID = /^[A-Za-z0-9._~:-]{1,200}$/;
const PROTECTED_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-shlita-api-key',
  'x-shlita-csrf',
  'x-shlita-operator-key',
  'x-shlita-simulation',
]);

export function requireGatewayUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ShlitaClientError('GATEWAY_URL', 'A gateway URL is required.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ShlitaClientError('GATEWAY_URL', 'The gateway URL must use http or https.');
  }
  if (url.username || url.password) {
    throw new ShlitaClientError('GATEWAY_URL', 'The gateway URL must not contain credentials.');
  }
  return url.toString().replace(/\/+$/, '');
}

export function requireCredential(value: string, label: string): string {
  if (!CREDENTIAL.test(value)) {
    throw new ShlitaClientError('CREDENTIAL', `${label} is required.`);
  }
  return value;
}

export function requireIdempotencyKey(value: string): string {
  if (!IDEMPOTENCY_KEY.test(value)) {
    throw new ShlitaClientError('IDEMPOTENCY_KEY', 'A billable request requires an idempotency key of 8–200 characters.');
  }
  return value;
}

export function requireMicroUsdc(value: string, label: string): string {
  if (!MICRO_USDC.test(value) || value === '0') {
    throw new ShlitaClientError('AMOUNT', `${label} must be a positive integer string of micro-USDC.`);
  }
  return value;
}

export function optionalRequestId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!REQUEST_ID.test(value)) {
    throw new ShlitaClientError('REQUEST_ID', 'The request id contains unsupported characters.');
  }
  return value;
}

export function callerHeaders(input: Record<string, string> | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input ?? {})) {
    if (PROTECTED_HEADERS.has(name.toLowerCase())) continue;
    headers[name] = value;
  }
  return headers;
}

export interface JsonResult {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}

export async function sendJson(options: {
  fetchImpl: typeof fetch;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
  idempotencyKey?: string;
  secret: string;
}): Promise<JsonResult> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await options.fetchImpl(options.url, {
      method: options.method,
      headers: options.headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal,
    });
  } catch (error) {
    const key = options.idempotencyKey ?? '';
    if (options.signal?.aborted) {
      throw new ShlitaUncertainError(
        'CANCELLED',
        key,
        'The request was cancelled. Reuse the same idempotency key; it was not sent again.'
      );
    }
    if (timeout.aborted || isTimeout(error)) {
      throw new ShlitaUncertainError(
        'TIMEOUT',
        key,
        'The gateway did not answer before the timeout. The provider is not known to have failed, and the request was not sent again.'
      );
    }
    throw new ShlitaUncertainError(
      'NETWORK',
      key,
      'The gateway connection failed. The request was not sent again.'
    );
  }

  const text = await response.text();
  if (!text) return { status: response.status, body: {}, headers: response.headers };
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ShlitaApiError(response.status, 'MALFORMED_RESPONSE', 'The gateway returned a response that is not a JSON object.');
    }
    return { status: response.status, body: parsed as Record<string, unknown>, headers: response.headers };
  } catch (error) {
    if (error instanceof ShlitaApiError) throw error;
    throw new ShlitaApiError(response.status, 'MALFORMED_RESPONSE', 'The gateway returned malformed JSON.');
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

export function readString(body: Record<string, unknown>, key: string): string | undefined {
  return typeof body[key] === 'string' ? body[key] : undefined;
}
