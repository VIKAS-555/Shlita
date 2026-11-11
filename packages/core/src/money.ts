/** Largest micro-USDC amount the ledger will accept. $1,000,000 at 6 decimals. */
export const MAX_MICRO_USDC = 1_000_000_000_000n;

const INTEGER_TEXT = /^(0|[1-9][0-9]*)$/;

export type ParsedAmount =
  | { ok: true; amount: bigint }
  | { ok: false; message: string };

/**
 * Accept only a base-10 integer. Reject floats, scientific notation,
 * unsafe JS numbers, negatives, zero, and amounts above the ledger maximum.
 */
export function parseMicroUsdc(value: unknown): ParsedAmount {
  let amount: bigint;
  if (typeof value === 'bigint') {
    amount = value;
  } else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      return { ok: false, message: 'Amount is not a safe integer.' };
    }
    amount = BigInt(value);
  } else if (typeof value === 'string' && INTEGER_TEXT.test(value)) {
    amount = BigInt(value);
  } else {
    return { ok: false, message: 'Amount must be a positive integer in micro-USDC.' };
  }

  if (amount <= 0n) {
    return { ok: false, message: 'Amount must be greater than zero.' };
  }
  if (amount > MAX_MICRO_USDC) {
    return { ok: false, message: 'Amount exceeds the supported maximum.' };
  }
  return { ok: true, amount };
}

export function parseStoredMicroUsdc(value: unknown): bigint {
  if (typeof value !== 'string' || !INTEGER_TEXT.test(value)) {
    throw new Error('Stored micro-USDC amount is corrupt.');
  }
  const amount = BigInt(value);
  if (amount < 0n || amount > MAX_MICRO_USDC) {
    throw new Error('Stored micro-USDC amount is outside the supported range.');
  }
  return amount;
}
