export class ShlitaClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ShlitaClientError';
    this.code = code;
  }
}

/** The billable request was dispatched at most once, and its outcome is not known. */
export class ShlitaUncertainError extends ShlitaClientError {
  readonly idempotencyKey: string;
  readonly requestsAttempted = 1;

  constructor(code: 'TIMEOUT' | 'NETWORK' | 'CANCELLED', idempotencyKey: string, message: string) {
    super(code, message);
    this.name = 'ShlitaUncertainError';
    this.idempotencyKey = idempotencyKey;
  }
}

export class ShlitaApiError extends ShlitaClientError {
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(code, message);
    this.name = 'ShlitaApiError';
    this.status = status;
  }
}
