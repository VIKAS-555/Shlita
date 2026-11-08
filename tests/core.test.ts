import { describe, it, expect, beforeEach } from 'vitest';
import {
  createPolicyEngine,
  PolicyEngine,
  SpendingPolicy,
  OutboundRequest,
} from '../packages/core/src/index.js';

describe('Shlita Core Policy Engine (Public Seam)', () => {
  let engine: PolicyEngine;

  const defaultPolicy: SpendingPolicy = {
    agentId: 'agent-researcher-01',
    allowedVendors: ['api.helius.xyz', 'api.tavily.com'],
    maxPerCallMicroUsdc: 50_000n, // $0.05 USDC
    periodBudgetMicroUsdc: 200_000n, // $0.20 USDC
    periodSeconds: 3600, // 1 hour
    circuitBreaker: {
      maxConsecutiveErrors: 3,
      maxCallsPerMinute: 10,
    },
  };

  beforeEach(() => {
    engine = createPolicyEngine();
    engine.registerAgent(defaultPolicy);
  });

  it('allows an outbound request to an approved vendor within budget', () => {
    const request: OutboundRequest = {
      agentId: 'agent-researcher-01',
      vendor: 'api.helius.xyz',
      estimatedCostMicroUsdc: 20_000n, // $0.02 USDC
      timestamp: Date.now(),
    };

    const decision = engine.evaluate(request);

    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.authorizedAmountMicroUsdc).toBe(20_000n);
    }
  });

  it('strictly blocks requests to unwhitelisted vendors', () => {
    const request: OutboundRequest = {
      agentId: 'agent-researcher-01',
      vendor: 'malicious-or-unknown-api.com',
      estimatedCostMicroUsdc: 10_000n,
      timestamp: Date.now(),
    };

    const decision = engine.evaluate(request);

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('UNAPPROVED_VENDOR');
    }
  });

  it('rejects a single request that exceeds maxPerCall spending cap', () => {
    const request: OutboundRequest = {
      agentId: 'agent-researcher-01',
      vendor: 'api.helius.xyz',
      estimatedCostMicroUsdc: 60_000n, // exceeds 50_000n limit
      timestamp: Date.now(),
    };

    const decision = engine.evaluate(request);

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('PER_CALL_LIMIT_EXCEEDED');
    }
  });

  it('tracks cumulative period spending and rejects requests that exceed period budget', () => {
    const now = Date.now();

    // Spend 4 * 45_000n = 180_000n (out of 200_000n limit)
    for (let i = 0; i < 4; i++) {
      const req: OutboundRequest = {
        agentId: 'agent-researcher-01',
        vendor: 'api.helius.xyz',
        estimatedCostMicroUsdc: 45_000n,
        timestamp: now + i * 1000,
      };
      const d = engine.evaluate(req);
      expect(d.allowed).toBe(true);
      engine.recordExecution(req, { success: true, actualCostMicroUsdc: 45_000n });
    }

    // Next request of 30_000n would bring total to 210_000n (> 200_000n)
    const exceedingReq: OutboundRequest = {
      agentId: 'agent-researcher-01',
      vendor: 'api.helius.xyz',
      estimatedCostMicroUsdc: 30_000n,
      timestamp: now + 5000,
    };

    const decision = engine.evaluate(exceedingReq);

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('PERIOD_BUDGET_EXCEEDED');
    }
  });

  it('trips circuit breaker when consecutive error threshold is breached', () => {
    const now = Date.now();
    const req: OutboundRequest = {
      agentId: 'agent-researcher-01',
      vendor: 'api.helius.xyz',
      estimatedCostMicroUsdc: 10_000n,
      timestamp: now,
    };

    // Simulate 3 consecutive failed executions
    for (let i = 0; i < 3; i++) {
      engine.recordExecution(req, { success: false, error: '500 Internal Error' });
    }

    const state = engine.getAgentState('agent-researcher-01');
    expect(state.status).toBe('CIRCUIT_TRIPPED');

    // Future requests must be rejected
    const nextDecision = engine.evaluate(req);
    expect(nextDecision.allowed).toBe(false);
    if (!nextDecision.allowed) {
      expect(nextDecision.reason).toBe('CIRCUIT_BREAKER_TRIPPED');
    }
  });

  it('trips circuit breaker when call frequency (anomaly loop) exceeds rate threshold', () => {
    const now = Date.now();

    // Max is 10 calls per minute; simulate 11 calls within 10 seconds
    for (let i = 0; i < 11; i++) {
      const req: OutboundRequest = {
        agentId: 'agent-researcher-01',
        vendor: 'api.helius.xyz',
        estimatedCostMicroUsdc: 1_000n,
        timestamp: now + i * 500,
      };
      const d = engine.evaluate(req);
      if (i < 10) {
        expect(d.allowed).toBe(true);
        engine.recordExecution(req, { success: true, actualCostMicroUsdc: 1_000n });
      } else {
        // 11th call should trip circuit breaker
        expect(d.allowed).toBe(false);
        if (!d.allowed) {
          expect(d.reason).toBe('RATE_ANOMALY_LOOP_DETECTED');
        }
      }
    }
  });

  it('enforces manual emergency kill-switch and unfreeze', () => {
    const req: OutboundRequest = {
      agentId: 'agent-researcher-01',
      vendor: 'api.helius.xyz',
      estimatedCostMicroUsdc: 10_000n,
      timestamp: Date.now(),
    };

    // Operator triggers emergency freeze
    engine.freezeAgent('agent-researcher-01', 'Operator manual freeze');
    let decision = engine.evaluate(req);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('AGENT_FROZEN');
    }

    // Operator unfreezes
    engine.unfreezeAgent('agent-researcher-01');
    decision = engine.evaluate(req);
    expect(decision.allowed).toBe(true);
  });
});
