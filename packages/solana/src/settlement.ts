import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  PROGRAM_ID as CANONICAL_SUBSCRIPTIONS_PROGRAM_ID,
  findSubscriptionAuthorityPda,
  findFixedDelegationPda,
  findEventAuthorityPda,
  getInitSubscriptionAuthorityInstruction,
  getCreateFixedDelegationInstruction,
  getTransferFixedInstruction,
} from '@solana/subscriptions';
import { TransactionLifecycleState } from '../../core/src/types.js';

export const USDC_MINT_MAINNET = new PublicKey(
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
);

export const USDC_MINT_DEVNET = new PublicKey(
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
);

// Canonical official program ID from solana-foundation/subscriptions
export const SUBSCRIPTIONS_PROGRAM_ID = new PublicKey(
  CANONICAL_SUBSCRIPTIONS_PROGRAM_ID || 'De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44'
);

export interface PreparedSettlement {
  transaction: Transaction;
  signature?: string;
  amountMicroUsdc: bigint;
  amountUsdcFormatted: string;
  subscriberPubkey: string;
  merchantPubkey: string;
  subscriberAta: string;
  merchantAta: string;
  pdaAuthority: string;
  pdaBump: number;
  delegationPda?: string;
  delegationBump?: number;
  eventAuthority?: string;
  usdcMint: string;
  cluster: 'localnet' | 'devnet' | 'mainnet-beta';
  status: TransactionLifecycleState;
  explorerUrl?: string;
  finality?: 'confirmed' | 'finalized';
}

export class SolanaSettlementManager {
  private connection: Connection;
  private operatorKeypair?: Keypair;
  private usdcMint: PublicKey;
  private programId: PublicKey;
  private isMainnet: boolean;

  constructor(
    rpcUrl = 'http://127.0.0.1:8899',
    payerKeypair?: Keypair,
    isMainnet = false,
    connection?: Connection
  ) {
    if (isMainnet && process.env.SHLITA_ALLOW_MAINNET !== 'true') {
      throw new Error('Mainnet settlement is disabled.');
    }
    this.connection = connection ?? new Connection(rpcUrl, 'confirmed');
    this.operatorKeypair = payerKeypair;
    this.isMainnet = isMainnet;
    this.usdcMint = isMainnet ? USDC_MINT_MAINNET : USDC_MINT_DEVNET;
    this.programId = SUBSCRIPTIONS_PROGRAM_ID;
  }

  getProgramId(): PublicKey {
    return this.programId;
  }

  getUsdcMint(): PublicKey {
    return this.usdcMint;
  }

  getCluster(): 'localnet' | 'devnet' | 'mainnet-beta' {
    if (this.isMainnet) return 'mainnet-beta';
    const endpoint = (this.connection as Connection & { rpcEndpoint?: string }).rpcEndpoint ?? '';
    if (endpoint.includes('devnet')) return 'devnet';
    return 'localnet';
  }

  getOperatorPublicKey(): PublicKey | undefined {
    return this.operatorKeypair?.publicKey;
  }

  /**
   * Derives official Subscription Authority PDA:
   * Seeds: ["SubscriptionAuthority", user, token_mint]
   */
  async deriveSubscriptionAuthorityPda(
    user: PublicKey,
    mint: PublicKey = this.usdcMint
  ): Promise<[PublicKey, number]> {
    const [address, bump] = await findSubscriptionAuthorityPda({
      user: user.toBase58() as any,
      tokenMint: mint.toBase58() as any,
    });
    return [new PublicKey(address), bump];
  }

  /**
   * Derives official Fixed Delegation PDA:
   * Seeds: ["delegation", subscription_authority, delegator, delegatee, nonce]
   */
  async deriveFixedDelegationPda(
    subscriptionAuthority: PublicKey,
    delegator: PublicKey,
    delegatee: PublicKey,
    nonce = 0n
  ): Promise<[PublicKey, number]> {
    const [address, bump] = await findFixedDelegationPda({
      subscriptionAuthority: subscriptionAuthority.toBase58() as any,
      delegator: delegator.toBase58() as any,
      delegatee: delegatee.toBase58() as any,
      nonce,
    });
    return [new PublicKey(address), bump];
  }

  /**
   * Derives Event Authority PDA for official Subscriptions program
   */
  async deriveEventAuthorityPda(): Promise<[PublicKey, number]> {
    const [address, bump] = await findEventAuthorityPda();
    return [new PublicKey(address), bump];
  }

  /**
   * Prepares a genuine, cryptographically valid Solana transaction using official
   * Solana Subscriptions instructions and SPL Token TransferChecked CPI pattern.
   */
  async prepareSettlementTransaction(
    subscriber: PublicKey,
    merchant: PublicKey,
    amountMicroUsdc: bigint,
    options: {
      nonce?: bigint;
      allowanceMicroUsdc?: bigint;
      expiryTs?: bigint;
      nowTs?: bigint;
      decimals?: number;
    } = {}
  ): Promise<PreparedSettlement> {
    if (amountMicroUsdc <= 0n) {
      throw new Error('Settlement amount must be a positive integer in micro-USDC');
    }
    if (amountMicroUsdc > 18446744073709551615n) {
      throw new Error('Settlement amount exceeds u64 maximum base units');
    }
    if (options.decimals !== undefined && options.decimals !== 6) {
      throw new Error('Only a 6-decimal mint is accepted for USDC settlement.');
    }
    if (options.allowanceMicroUsdc !== undefined && amountMicroUsdc > options.allowanceMicroUsdc) {
      throw new Error('Settlement amount exceeds the authorized delegation allowance.');
    }
    if (
      options.expiryTs !== undefined &&
      options.nowTs !== undefined &&
      options.nowTs >= options.expiryTs
    ) {
      throw new Error('Delegation has expired.');
    }

    const delegatee = merchant;
    const [pdaAuthority, bump] = await this.deriveSubscriptionAuthorityPda(subscriber, this.usdcMint);
    const [delegationPda, delBump] = await this.deriveFixedDelegationPda(
      pdaAuthority,
      subscriber,
      delegatee,
      options.nonce ?? 0n
    );
    const [eventAuthority] = await this.deriveEventAuthorityPda();
    const subscriberAta = getAssociatedTokenAddressSync(this.usdcMint, subscriber, true);
    const merchantAta = getAssociatedTokenAddressSync(this.usdcMint, merchant, true);

    const instruction = getTransferFixedInstruction({
      delegationPda: delegationPda.toBase58() as any,
      subscriptionAuthority: pdaAuthority.toBase58() as any,
      delegatorAta: subscriberAta.toBase58() as any,
      receiverAta: merchantAta.toBase58() as any,
      tokenMint: this.usdcMint.toBase58() as any,
      tokenProgram: TOKEN_PROGRAM_ID.toBase58() as any,
      delegatee: addressSigner(delegatee),
      eventAuthority: eventAuthority.toBase58() as any,
      selfProgram: this.programId.toBase58() as any,
      transferData: {
        amount: amountMicroUsdc,
        delegator: subscriber.toBase58() as any,
        mint: this.usdcMint.toBase58() as any,
      },
    });

    const tx = new Transaction().add(toWeb3Instruction(this.programId, instruction as never));
    if (this.operatorKeypair) tx.feePayer = this.operatorKeypair.publicKey;

    return {
      transaction: tx,
      amountMicroUsdc,
      amountUsdcFormatted: formatMicroUsdc(amountMicroUsdc),
      subscriberPubkey: subscriber.toBase58(),
      merchantPubkey: merchant.toBase58(),
      subscriberAta: subscriberAta.toBase58(),
      merchantAta: merchantAta.toBase58(),
      pdaAuthority: pdaAuthority.toBase58(),
      pdaBump: bump,
      delegationPda: delegationPda.toBase58(),
      delegationBump: delBump,
      eventAuthority: eventAuthority.toBase58(),
      usdcMint: this.usdcMint.toBase58(),
      cluster: this.getCluster(),
      status: 'SETTLEMENT_PREPARED',
    };
  }

  /**
   * Broadcasts one prepared transfer. A later call re-reads the original signature
   * and does not construct or send another payment.
   * Signature confirmation is not SETTLEMENT_CONFIRMED until balances are observed.
   */
  async submitSettlementTransaction(
    prepared: PreparedSettlement,
    payer: Keypair
  ): Promise<{ success: boolean; signature?: string; slot?: number; error?: string }> {
    if (prepared.signature || prepared.status === 'SETTLEMENT_OUTCOME_UNKNOWN' || prepared.status === 'SETTLEMENT_SUBMITTED' || prepared.status === 'SETTLEMENT_CONFIRMATION_PENDING') {
      return this.reconcilePrepared(prepared);
    }
    const delegateeKey = prepared.transaction.instructions[0]?.keys.find(
      (key) => key.pubkey.equals(payer.publicKey) && key.isSigner
    );
    if (!delegateeKey) {
      prepared.status = 'SETTLEMENT_FAILED';
      return { success: false, error: 'The fee payer is not the delegatee required by transfer_fixed.' };
    }

    let broadcastStarted = false;
    try {
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
      prepared.transaction.recentBlockhash = blockhash;
      prepared.transaction.feePayer = payer.publicKey;
      prepared.transaction.sign(payer);
      broadcastStarted = true;
      const signature = await this.connection.sendRawTransaction(prepared.transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      prepared.signature = signature;
      prepared.status = 'SETTLEMENT_SUBMITTED';
      const confirmation = await this.connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        'confirmed'
      );
      if (confirmation.value.err) {
        prepared.status = 'SETTLEMENT_FAILED';
        return { success: false, signature, error: `On-chain execution failed: ${JSON.stringify(confirmation.value.err)}` };
      }
      prepared.status = 'SETTLEMENT_CONFIRMATION_PENDING';
      prepared.explorerUrl = explorerUrl(prepared.cluster, signature);
      return { success: false, signature, slot: confirmation.context.slot, error: 'Signature landed. Token balances have not been observed.' };
    } catch (err: any) {
      prepared.status = broadcastStarted ? 'SETTLEMENT_OUTCOME_UNKNOWN' : 'SETTLEMENT_FAILED';
      return { success: false, signature: prepared.signature, error: err?.message || 'Solana RPC transaction submission error' };
    }
  }

  async reconcilePrepared(
    prepared: PreparedSettlement
  ): Promise<{ success: boolean; signature?: string; slot?: number; error?: string }> {
    if (!prepared.signature) {
      prepared.status = 'SETTLEMENT_OUTCOME_UNKNOWN';
      return { success: false, error: 'Broadcast outcome is unknown and no signature was persisted.' };
    }
    try {
      const status = await this.connection.getSignatureStatuses([prepared.signature]);
      const value = status.value[0];
      if (!value) {
        prepared.status = 'SETTLEMENT_OUTCOME_UNKNOWN';
        return { success: false, signature: prepared.signature, error: 'Signature is not visible on the cluster yet.' };
      }
      if (value.err) {
        prepared.status = 'SETTLEMENT_FAILED';
        return { success: false, signature: prepared.signature, error: `On-chain execution failed: ${JSON.stringify(value.err)}` };
      }
      prepared.finality = value.confirmationStatus === 'finalized' ? 'finalized' : 'confirmed';
      prepared.status = 'SETTLEMENT_CONFIRMATION_PENDING';
      return { success: false, signature: prepared.signature, slot: value.slot, error: 'Token balances have not been observed.' };
    } catch (err: any) {
      prepared.status = 'SETTLEMENT_OUTCOME_UNKNOWN';
      return { success: false, signature: prepared.signature, error: err?.message || 'RPC status query failed' };
    }
  }

  observeBalances(
    prepared: PreparedSettlement,
    balances: { sourceBefore: bigint; sourceAfter: bigint; destinationBefore: bigint; destinationAfter: bigint }
  ): void {
    const sourceDelta = balances.sourceBefore - balances.sourceAfter;
    const destinationDelta = balances.destinationAfter - balances.destinationBefore;
    if (sourceDelta !== prepared.amountMicroUsdc || destinationDelta !== prepared.amountMicroUsdc) {
      throw new Error('Observed token balances do not match the authorized amount.');
    }
    if (prepared.status !== 'SETTLEMENT_CONFIRMATION_PENDING') {
      throw new Error('Balances can be applied only after the signature is visible on-chain.');
    }
    prepared.status = prepared.finality === 'finalized' ? 'SETTLEMENT_FINALIZED' : 'SETTLEMENT_CONFIRMED';
  }

  async simulateSettlement(
    prepared: PreparedSettlement
  ): Promise<{ success: boolean; logs?: string[]; error?: string }> {
    try {
      const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
      prepared.transaction.recentBlockhash = blockhash;
      const sim = await this.connection.simulateTransaction(prepared.transaction);
      if (sim.value.err) {
        return { success: false, logs: sim.value.logs ?? [], error: JSON.stringify(sim.value.err) };
      }
      return { success: true, logs: sim.value.logs ?? [] };
    } catch (err: any) {
      return { success: false, error: err?.message || 'RPC simulation error' };
    }
  }
}

function formatMicroUsdc(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${fraction}`;
}

function addressSigner(pubkey: PublicKey) {
  return {
    address: pubkey.toBase58(),
    signTransactions: async () => {
      throw new Error('transfer_fixed is signed by the delegatee keypair, not by the instruction builder.');
    },
  } as any;
}

function toWeb3Instruction(programId: PublicKey, instruction: { programAddress: string; accounts: ReadonlyArray<{ address: string; role: number }>; data: Uint8Array | Readonly<Uint8Array> }): TransactionInstruction {
  if (instruction.programAddress !== programId.toBase58()) {
    throw new Error('Subscriptions instruction was built for an unexpected program.');
  }
  return new TransactionInstruction({
    programId,
    keys: instruction.accounts.map((account) => ({
      pubkey: new PublicKey(account.address),
      isSigner: (account.role & 2) === 2,
      isWritable: (account.role & 1) === 1,
    })),
    data: Buffer.from(instruction.data),
  });
}

function explorerUrl(cluster: PreparedSettlement['cluster'], signature: string): string {
  if (cluster === 'localnet') return `http://127.0.0.1:8899/tx/${signature}`;
  const query = cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${query}`;
}
