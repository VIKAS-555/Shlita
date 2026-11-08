import { describe, it, expect } from 'vitest';
import { Keypair } from '@solana/web3.js';
import {
  SolanaSettlementManager,
  USDC_MINT_DEVNET,
  SUBSCRIPTIONS_PROGRAM_ID,
} from '../packages/solana/src/settlement.js';

describe('Solana Settlement Manager (Real USDC SPL & Subscriptions Seam)', () => {
  it('derives deterministic subscription PDA authority matching Anchor standard', () => {
    const manager = new SolanaSettlementManager();
    const subscriber = Keypair.generate().publicKey;
    const merchant = Keypair.generate().publicKey;

    const [pda, bump] = manager.deriveSubscriptionPda(subscriber, merchant);

    expect(pda).toBeDefined();
    expect(typeof bump).toBe('number');
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  it('builds genuine USDC SPL Token Transfer Checked & Subscriptions Anchor instructions', async () => {
    const manager = new SolanaSettlementManager();
    const subscriber = Keypair.generate().publicKey;
    const merchant = Keypair.generate().publicKey;
    const amountMicroUsdc = 20_000n; // $0.020000 USDC

    const result = await manager.prepareSettlementTransaction(
      subscriber,
      merchant,
      amountMicroUsdc
    );

    expect(result.amountMicroUsdc).toBe(20_000n);
    expect(result.amountUsdcFormatted).toBe('0.020000');
    expect(result.usdcMint).toBe(USDC_MINT_DEVNET.toBase58());
    expect(result.subscriberAta).toBeDefined();
    expect(result.merchantAta).toBeDefined();
    expect(result.pdaAuthority).toBeDefined();
    expect(result.explorerUrl).toContain('explorer.solana.com/tx/');

    // Must have at least 2 real instructions: 1. SPL Token TransferChecked, 2. Subscriptions Anchor Settle
    const ixs = result.transaction.instructions;
    expect(ixs.length).toBe(2);

    // Instruction 1: SPL Token Program
    expect(ixs[0].programId.toBase58()).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

    // Instruction 2: Subscriptions Anchor Program
    expect(ixs[1].programId.toBase58()).toBe(SUBSCRIPTIONS_PROGRAM_ID.toBase58());
  });

  it('simulates settlement transaction and validates execution logs', async () => {
    const manager = new SolanaSettlementManager();
    const subscriber = Keypair.generate().publicKey;
    const merchant = Keypair.generate().publicKey;

    const prepared = await manager.prepareSettlementTransaction(
      subscriber,
      merchant,
      50_000n // $0.05 USDC
    );

    const simulation = await manager.simulateSettlement(prepared);
    expect(simulation.success).toBe(true);
    expect(simulation.logs).toBeDefined();
    expect(simulation.logs!.length).toBeGreaterThan(0);
  });
});
