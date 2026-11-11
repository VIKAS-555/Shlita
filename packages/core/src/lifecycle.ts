import crypto from 'node:crypto';
import type { TransactionLifecycleState } from './types.js';

/**
 * Vendor success, accounting commitment, and chain settlement are different states.
 * A transition that is not listed here is impossible.
 */
export const FINANCIAL_TRANSITIONS: Record<TransactionLifecycleState, readonly TransactionLifecycleState[]> = {
  REQUEST_RECEIVED: ['POLICY_REJECTED', 'BUDGET_RESERVED'],
  POLICY_REJECTED: [],
  BUDGET_RESERVED: ['EXECUTION_IN_PROGRESS'],
  EXECUTION_IN_PROGRESS: ['VENDOR_SUCCEEDED', 'VENDOR_FAILED', 'EXECUTION_OUTCOME_UNKNOWN'],
  VENDOR_SUCCEEDED: ['ACCOUNTING_COMMITTED', 'RECONCILIATION_REQUIRED'],
  VENDOR_FAILED: [],
  EXECUTION_OUTCOME_UNKNOWN: ['RECONCILIATION_REQUIRED'],
  ACCOUNTING_COMMITTED: ['SETTLEMENT_PENDING'],
  RECONCILIATION_REQUIRED: [],
  SETTLEMENT_PENDING: ['SETTLEMENT_CONFIRMED', 'SETTLEMENT_FAILED'],
  SETTLEMENT_CONFIRMED: [],
  SETTLEMENT_FAILED: [],
};

export function canTransition(from: TransactionLifecycleState, to: TransactionLifecycleState): boolean {
  return FINANCIAL_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TransactionLifecycleState, to: TransactionLifecycleState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal financial transition ${from} -> ${to}`);
  }
}

/** In-flight rows recovered after a restart. They are not safe to replay. */
export const IN_FLIGHT_STATES: readonly TransactionLifecycleState[] = [
  'BUDGET_RESERVED',
  'EXECUTION_IN_PROGRESS',
  'VENDOR_SUCCEEDED',
  'EXECUTION_OUTCOME_UNKNOWN',
];

/** Reservations behind these states stay held. Expiry must not drop an uncertain charge. */
export const RESERVATION_HOLD_STATES: readonly TransactionLifecycleState[] = [
  ...IN_FLIGHT_STATES,
  'RECONCILIATION_REQUIRED',
];

export function idempotencyReference(idempotencyKey: string): string {
  return crypto.createHash('sha256').update(idempotencyKey).digest('hex');
}
