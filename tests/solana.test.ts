import { describe, it, expect } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { SolanaSettlementManager } from '../packages/solana/src/settlement.js';

describe('Solana Settlement Manager', () => {
  it('derives deterministic subscription PDA and creates settlement transaction', async () => {
    const manager = new SolanaSettlementManager();
    const subscriber = Keypair.generate().publicKey;
    const merchant = Keypair.generate().publicKey;
    const dummyProgram = Keypair.generate().publicKey;

    const [pda, bump] = manager.deriveSubscriptionPda(subscriber, merchant, dummyProgram);

    expect(pda).toBeDefined();
    expect(typeof bump).toBe('number');

    const result = await manager.prepareSettlementTransaction(
      subscriber,
      merchant,
      25_000n
    );

    expect(result.simulatedSignature).toContain('5sol_');
    expect(result.transaction.instructions.length).toBeGreaterThan(0);
  });
});
