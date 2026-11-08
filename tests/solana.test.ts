import { describe, it, expect } from 'vitest';
import { Keypair } from '@solana/web3.js';
import {
  SolanaSettlementManager,
  USDC_MINT_DEVNET,
  USDC_MINT_MAINNET,
  SUBSCRIPTIONS_PROGRAM_ID,
} from '../packages/solana/src/settlement.js';

describe('Solana Settlement Manager (Canonical Protocol & Honest States)', () => {
  it('uses official Solana Subscriptions program ID and derives canonical authority PDA', async () => {
    const manager = new SolanaSettlementManager();
    expect(manager.getProgramId().toBase58()).toBe(
      'De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44'
    );

    const subscriber = Keypair.generate().publicKey;
    const [authorityPda, bump] = await manager.deriveSubscriptionAuthorityPda(
      subscriber,
      USDC_MINT_DEVNET
    );

    expect(authorityPda).toBeDefined();
    expect(typeof bump).toBe('number');
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  it('derives canonical Fixed Delegation PDA per (authority, delegator, delegatee, nonce)', async () => {
    const manager = new SolanaSettlementManager();
    const subscriber = Keypair.generate().publicKey;
    const merchant = Keypair.generate().publicKey;

    const [authorityPda] = await manager.deriveSubscriptionAuthorityPda(
      subscriber,
      USDC_MINT_DEVNET
    );
    const [delegationPda, bump] = await manager.deriveFixedDelegationPda(
      authorityPda,
      subscriber,
      merchant,
      0n
    );

    expect(delegationPda).toBeDefined();
    expect(typeof bump).toBe('number');
  });

  it('builds authentic instructions with exact 6-decimal micro-USDC base units and honest pending state', async () => {
    const manager = new SolanaSettlementManager();
    const subscriber = Keypair.generate().publicKey;
    const merchant = Keypair.generate().publicKey;
    const amountMicroUsdc = 20_000n; // $0.020000 USDC

    const prepared = await manager.prepareSettlementTransaction(
      subscriber,
      merchant,
      amountMicroUsdc
    );

    expect(prepared.amountMicroUsdc).toBe(20_000n);
    expect(prepared.amountUsdcFormatted).toBe('0.020000');
    expect(prepared.usdcMint).toBe(USDC_MINT_DEVNET.toBase58());
    expect(prepared.status).toBe('SETTLEMENT_PENDING');
    // Never fabricate synthetic signatures before submission!
    expect(prepared.signature).toBeUndefined();
    expect(prepared.explorerUrl).toBeUndefined();

    // Verify instructions
    const ixs = prepared.transaction.instructions;
    expect(ixs.length).toBeGreaterThanOrEqual(2);

    // 1. SPL Token Program
    expect(ixs[0].programId.toBase58()).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

    // 2. Official Subscriptions Program
    expect(ixs[1].programId.toBase58()).toBe(
      'De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44'
    );
  });

  it('rejects invalid amounts outside u64 base unit boundaries', async () => {
    const manager = new SolanaSettlementManager();
    const subscriber = Keypair.generate().publicKey;
    const merchant = Keypair.generate().publicKey;

    // Zero amount
    await expect(
      manager.prepareSettlementTransaction(subscriber, merchant, 0n)
    ).rejects.toThrow('positive integer');

    // Negative amount
    await expect(
      manager.prepareSettlementTransaction(subscriber, merchant, -500n)
    ).rejects.toThrow('positive integer');
  });

  it('fails closed on unfunded/invalid submission rather than faking success', async () => {
    const manager = new SolanaSettlementManager();
    const subscriber = Keypair.generate().publicKey;
    const merchant = Keypair.generate().publicKey;
    const unfundedPayer = Keypair.generate();

    const prepared = await manager.prepareSettlementTransaction(
      subscriber,
      merchant,
      10_000n
    );

    const submitResult = await manager.submitSettlementTransaction(prepared, unfundedPayer);
    // Unfunded random keypair cannot pay network transaction fee on Devnet
    expect(submitResult.success).toBe(false);
    expect(prepared.status).toBe('SETTLEMENT_FAILED');
    expect(submitResult.error).toBeDefined();
  });
});
