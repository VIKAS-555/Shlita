import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  SolanaSettlementManager,
  USDC_MINT_DEVNET,
  SUBSCRIPTIONS_PROGRAM_ID,
} from '../packages/solana/src/settlement.js';

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SUBSCRIPTIONS = 'De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44';
const BLOCKHASH = Keypair.generate().publicKey.toBase58();

function managerWith(connection: object): SolanaSettlementManager {
  return new SolanaSettlementManager('http://127.0.0.1:8899', undefined, false, connection as never);
}

describe('Solana settlement construction', () => {
  it('uses the Subscriptions program and derives its authority PDA', async () => {
    const manager = new SolanaSettlementManager();
    expect(manager.getProgramId().toBase58()).toBe(SUBSCRIPTIONS);
    expect(manager.getCluster()).toBe('localnet');
    const subscriber = Keypair.generate().publicKey;
    const [authorityPda, bump] = await manager.deriveSubscriptionAuthorityPda(subscriber, USDC_MINT_DEVNET);
    expect(authorityPda).toBeInstanceOf(PublicKey);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  it('builds one transfer_fixed instruction and does not add a direct SPL transfer', async () => {
    const manager = new SolanaSettlementManager();
    const subscriber = Keypair.generate().publicKey;
    const merchant = Keypair.generate().publicKey;
    const prepared = await manager.prepareSettlementTransaction(subscriber, merchant, 20_000n);

    expect(prepared.amountMicroUsdc).toBe(20_000n);
    expect(prepared.amountUsdcFormatted).toBe('0.020000');
    expect(prepared.status).toBe('SETTLEMENT_PREPARED');
    expect(prepared.signature).toBeUndefined();
    expect(prepared.transaction.instructions).toHaveLength(1);

    const [instruction] = prepared.transaction.instructions;
    expect(instruction.programId.toBase58()).toBe(SUBSCRIPTIONS_PROGRAM_ID.toBase58());
    expect(prepared.transaction.instructions.some((ix) => ix.programId.equals(TOKEN_PROGRAM_ID))).toBe(false);
    expect(instruction.programId.toBase58()).not.toBe(TOKEN_PROGRAM);

    const pda = instruction.keys.find((key) => key.pubkey.toBase58() === prepared.pdaAuthority);
    const delegatee = instruction.keys.find((key) => key.pubkey.equals(merchant));
    expect(pda?.isSigner).toBe(false);
    expect(delegatee?.isSigner).toBe(true);
  });

  it('rejects a non-positive amount, the wrong decimals, and an amount above the allowance', async () => {
    const manager = new SolanaSettlementManager();
    const subscriber = Keypair.generate().publicKey;
    const merchant = Keypair.generate().publicKey;
    await expect(manager.prepareSettlementTransaction(subscriber, merchant, 0n)).rejects.toThrow('positive integer');
    await expect(manager.prepareSettlementTransaction(subscriber, merchant, -500n)).rejects.toThrow('positive integer');
    await expect(manager.prepareSettlementTransaction(subscriber, merchant, 10n, { decimals: 9 })).rejects.toThrow('6-decimal');
    await expect(
      manager.prepareSettlementTransaction(subscriber, merchant, 10_000n, { allowanceMicroUsdc: 9_999n })
    ).rejects.toThrow('allowance');
  });

  it('refuses mainnet unless it is explicitly allowed', () => {
    expect(() => new SolanaSettlementManager('https://api.mainnet-beta.solana.com', undefined, true)).toThrow(/Mainnet/);
  });

  it('uses a configured local mint instead of the devnet USDC address', () => {
    const localMint = Keypair.generate().publicKey;
    const manager = new SolanaSettlementManager('http://127.0.0.1:8899', undefined, false, undefined, localMint);
    expect(manager.getUsdcMint().equals(localMint)).toBe(true);
    expect(manager.getUsdcMint().equals(USDC_MINT_DEVNET)).toBe(false);
  });

  it('does not broadcast when the signer is not the delegatee', async () => {
    let calls = 0;
    const connection = {
      getLatestBlockhash: async () => {
        calls += 1;
        return { blockhash: BLOCKHASH, lastValidBlockHeight: 1 };
      },
      sendRawTransaction: async () => {
        calls += 1;
        return 'signature';
      },
    };
    const manager = managerWith(connection);
    const subscriber = Keypair.generate().publicKey;
    const merchant = Keypair.generate().publicKey;
    const prepared = await manager.prepareSettlementTransaction(subscriber, merchant, 10_000n);
    const result = await manager.submitSettlementTransaction(prepared, Keypair.generate());
    expect(result.success).toBe(false);
    expect(prepared.status).toBe('SETTLEMENT_FAILED');
    expect(calls).toBe(0);
  });

  it('keeps an unknown broadcast unresolved and does not send a second transfer', async () => {
    let sends = 0;
    const connection = {
      getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 9 }),
      sendRawTransaction: async () => {
        sends += 1;
        const error = new Error('request timed out');
        error.name = 'TimeoutError';
        throw error;
      },
      getSignatureStatuses: async () => ({ value: [null] }),
    };
    const manager = managerWith(connection);
    const merchant = Keypair.generate();
    const prepared = await manager.prepareSettlementTransaction(Keypair.generate().publicKey, merchant.publicKey, 10_000n);
    const first = await manager.submitSettlementTransaction(prepared, merchant);
    const second = await manager.submitSettlementTransaction(prepared, merchant);
    expect(first.success).toBe(false);
    expect(prepared.status).toBe('SETTLEMENT_OUTCOME_UNKNOWN');
    expect(second.success).toBe(false);
    expect(sends).toBe(1);
  });

  it('confirms only after the signature is visible and the balances match', async () => {
    const connection = {
      getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 9 }),
      sendRawTransaction: async () => 'sig-observed',
      confirmTransaction: async () => ({ value: { err: null }, context: { slot: 4 } }),
      getSignatureStatuses: async () => ({ value: [{ err: null, slot: 4, confirmationStatus: 'finalized' }] }),
    };
    const manager = managerWith(connection);
    const merchant = Keypair.generate();
    const prepared = await manager.prepareSettlementTransaction(Keypair.generate().publicKey, merchant.publicKey, 10_000n);
    const submitted = await manager.submitSettlementTransaction(prepared, merchant);
    expect(submitted.success).toBe(false);
    expect(prepared.status).toBe('SETTLEMENT_CONFIRMATION_PENDING');
    expect(prepared.signature).toBe('sig-observed');
    expect(() =>
      manager.observeBalances(prepared, { sourceBefore: 50_000n, sourceAfter: 40_000n, destinationBefore: 0n, destinationAfter: 5_000n })
    ).toThrow(/balances/);
    prepared.finality = 'finalized';
    manager.observeBalances(prepared, { sourceBefore: 50_000n, sourceAfter: 40_000n, destinationBefore: 1n, destinationAfter: 10_001n });
    expect(prepared.status).toBe('SETTLEMENT_FINALIZED');
  });

  it('does not invent simulation logs', async () => {
    const manager = managerWith({
      getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 1 }),
      simulateTransaction: async () => ({ value: { err: null, logs: null } }),
    });
    const prepared = await manager.prepareSettlementTransaction(Keypair.generate().publicKey, Keypair.generate().publicKey, 10n);
    const simulated = await manager.simulateSettlement(prepared);
    expect(simulated.success).toBe(true);
    expect(simulated.logs).toEqual([]);
  });
});
