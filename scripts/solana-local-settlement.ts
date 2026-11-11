/**
 * Funded local-validator settlement.
 *
 * This is not part of `npm test`. It exits 2 when the toolchain or the
 * pinned program binary is missing, and 0 only after a real token movement.
 *
 * Pin:
 *   @solana/subscriptions 0.5.0
 *   solana-foundation/subscriptions program-v0.5.0
 *   commit 364a41976c33347d092902443bbec2def9227e75
 *
 * Build the program, then point this script at the .so:
 *   git clone --branch program-v0.5.0 https://github.com/solana-foundation/subscriptions.git
 *   cd subscriptions/program && cargo build-sbf
 *   SHLITA_SUBSCRIPTIONS_SO=../target/deploy/subscriptions_program.so npm run test:solana-local
 */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import {
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  decodeFixedDelegation,
  getCreateFixedDelegationInstruction,
  getInitSubscriptionAuthorityInstruction,
  UNKNOWN_INIT_ID,
} from '@solana/subscriptions';
import { serve } from '@hono/node-server';
import { bootFromEnv } from '../packages/gateway/src/bootstrap.js';
import { SolanaSettlementManager, SUBSCRIPTIONS_PROGRAM_ID } from '../packages/solana/src/settlement.js';

const PROGRAM_ID = 'De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44';
const AUTHORIZED = 10_000n;
const ALLOWANCE = 50_000n;
const RPC_PORT = 18999;

function blocked(message: string): never {
  console.error(`BLOCKED: ${message}`);
  process.exit(2);
}

function validatorBin(): string {
  if (process.env.SOLANA_TEST_VALIDATOR && fs.existsSync(process.env.SOLANA_TEST_VALIDATOR)) {
    return process.env.SOLANA_TEST_VALIDATOR;
  }
  const probe = spawnSync('solana-test-validator', ['--version'], { encoding: 'utf8' });
  if (probe.status === 0) return 'solana-test-validator';
  const fallback = path.join(os.homedir(), '.local/share/solana/install/active_release/bin/solana-test-validator');
  if (fs.existsSync(fallback)) return fallback;
  blocked('solana-test-validator is not installed, so funded on-chain settlement was not executed.');
}

function programBinary(): string {
  const so = process.env.SHLITA_SUBSCRIPTIONS_SO;
  if (!so || !fs.existsSync(so)) {
    blocked(
      'SHLITA_SUBSCRIPTIONS_SO is not a subscriptions_program.so built from program-v0.5.0 (364a41976c33347d092902443bbec2def9227e75). The local validator was not asked to move tokens.'
    );
  }
  return so;
}

function addressSigner(pubkey: PublicKey) {
  return {
    address: pubkey.toBase58(),
    signTransactions: async () => {
      throw new Error('Enrollment is signed by the wallet keypair, not by the instruction builder.');
    },
  } as never;
}

function toWeb3Instruction(instruction: {
  programAddress: string;
  accounts: ReadonlyArray<{ address: string; role: number }>;
  data: Uint8Array;
}): TransactionInstruction {
  if (instruction.programAddress !== PROGRAM_ID) {
    throw new Error(`Instruction program ${instruction.programAddress} is not ${PROGRAM_ID}.`);
  }
  return new TransactionInstruction({
    programId: SUBSCRIPTIONS_PROGRAM_ID,
    keys: instruction.accounts.map((account) => ({
      pubkey: new PublicKey(account.address),
      isSigner: (account.role & 2) === 2,
      isWritable: (account.role & 1) === 1,
    })),
    data: Buffer.from(instruction.data),
  });
}

async function waitForHealth(rpc: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      });
      const body = (await response.json()) as { result?: string };
      if (body.result === 'ok') return;
    } catch {
      /* validator is still opening the port */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Local validator did not become healthy.');
}

async function send(
  connection: Connection,
  instructions: TransactionInstruction[],
  feePayer: Keypair,
  signers: Keypair[]
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction().add(...instructions);
  tx.feePayer = feePayer.publicKey;
  tx.recentBlockhash = blockhash;
  tx.sign(...signers);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  const confirmation = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  if (confirmation.value.err) {
    const detail = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    throw new Error(`Transaction ${signature} failed: ${JSON.stringify(confirmation.value.err)} ${detail?.meta?.logMessages?.join(' | ') ?? ''}`);
  }
  return signature;
}

async function tokenAmount(connection: Connection, address: PublicKey): Promise<bigint> {
  const account = await getAccount(connection, address);
  return account.amount;
}

async function delegationRemaining(connection: Connection, address: PublicKey): Promise<bigint> {
  const info = await connection.getAccountInfo(address, 'confirmed');
  if (!info) throw new Error('Fixed delegation account is missing.');
  const decoded = decodeFixedDelegation({
    address: address.toBase58() as never,
    data: new Uint8Array(info.data),
    executable: false,
    lamports: BigInt(info.lamports) as never,
    programAddress: PROGRAM_ID as never,
    exists: true,
  } as never);
  return decoded.data.amount;
}

async function main(): Promise<void> {
  const validator = validatorBin();
  const so = programBinary();
  const programHash = crypto.createHash('sha256').update(fs.readFileSync(so)).digest('hex');
  const rpc = `http://127.0.0.1:${RPC_PORT}`;
  const ledger = fs.mkdtempSync(path.join(os.tmpdir(), 'shlita-ledger-'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shlita-state-'));
  const upgradeAuthority = Keypair.generate();
  const logs: string[] = [];
  const child = spawn(
    validator,
    [
      '--reset',
      '--quiet',
      '--bind-address', '127.0.0.1',
      '--rpc-port', String(RPC_PORT),
      '--faucet-port', '18900',
      '--gossip-port', '18001',
      '--ledger', ledger,
      '--upgradeable-program', PROGRAM_ID, so, upgradeAuthority.publicKey.toBase58(),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  child.stdout?.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr?.on('data', (chunk) => logs.push(String(chunk)));

  let server: ReturnType<typeof serve> | undefined;
  try {
    await waitForHealth(rpc);
    const connection = new Connection(rpc, 'confirmed');
    const loaded = await connection.getAccountInfo(new PublicKey(PROGRAM_ID));
    if (!loaded?.executable) {
      throw new Error('Subscriptions program was not loaded as executable at the canonical address.');
    }

    const subscriber = Keypair.generate();
    const merchant = Keypair.generate();
    const airdropA = await connection.requestAirdrop(subscriber.publicKey, 2_000_000_000);
    const airdropB = await connection.requestAirdrop(merchant.publicKey, 2_000_000_000);
    await connection.confirmTransaction(airdropA, 'confirmed');
    await connection.confirmTransaction(airdropB, 'confirmed');

    const mint = await createMint(connection, subscriber, subscriber.publicKey, null, 6);
    const source = await createAssociatedTokenAccount(connection, subscriber, mint, subscriber.publicKey);
    const destination = await createAssociatedTokenAccount(connection, subscriber, mint, merchant.publicKey);
    await mintTo(connection, subscriber, mint, source, subscriber, 1_000_000n);

    const manager = new SolanaSettlementManager(rpc, merchant, false, connection, mint);
    const [authority] = await manager.deriveSubscriptionAuthorityPda(subscriber.publicKey, mint);
    const [delegation] = await manager.deriveFixedDelegationPda(authority, subscriber.publicKey, merchant.publicKey, 0n);
    const expiryTs = BigInt(Math.floor(Date.now() / 1000) + 86_400);
    const initIx = getInitSubscriptionAuthorityInstruction({
      owner: addressSigner(subscriber.publicKey),
      subscriptionAuthority: authority.toBase58() as never,
      tokenMint: mint.toBase58() as never,
      userAta: source.toBase58() as never,
      tokenProgram: TOKEN_PROGRAM_ID.toBase58() as never,
    });
    const createIx = getCreateFixedDelegationInstruction({
      delegator: addressSigner(subscriber.publicKey),
      subscriptionAuthority: authority.toBase58() as never,
      delegationAccount: delegation.toBase58() as never,
      delegatee: merchant.publicKey.toBase58() as never,
      fixedDelegation: {
        nonce: 0n,
        amount: ALLOWANCE,
        expiryTs,
        expectedSubscriptionAuthorityInitId: UNKNOWN_INIT_ID,
      },
    });
    const enrollmentSignature = await send(
      connection,
      [toWeb3Instruction(initIx as never), toWeb3Instruction(createIx as never)],
      subscriber,
      [subscriber]
    );
    const allowanceBefore = await delegationRemaining(connection, delegation);

    const booted = bootFromEnv({
      SHLITA_OPERATOR_KEY: 's'.repeat(40),
      SHLITA_OPERATOR_ORG: 'org-local-settle',
      SHLITA_ALLOW_SIMULATION: 'true',
      SHLITA_DB_PATH: path.join(stateDir, 'ledger.db'),
      SHLITA_STATE_DIR: stateDir,
      SHLITA_SETTLEMENT_ENABLED: 'true',
      SHLITA_SETTLEMENT_DESTINATION: merchant.publicKey.toBase58(),
      SHLITA_SETTLEMENT_MINT: mint.toBase58(),
      SOLANA_RPC_URL: rpc,
    });
    if (!booted.ok) throw new Error(booted.errors.join('; '));
    const agentKey = 'shlt_test_local_settle_01';
    booted.engine.registerAgent(
      {
        agentId: 'agent-local-settle',
        allowedVendors: ['api.helius.xyz'],
        maxPerCallMicroUsdc: 50_000n,
        periodBudgetMicroUsdc: 1_000_000n,
        periodSeconds: 86_400,
        circuitBreaker: { maxConsecutiveErrors: 3, maxCallsPerMinute: 10 },
      },
      { ownerOrg: 'org-local-settle', rawApiKey: agentKey }
    );
    await new Promise<void>((resolve, reject) => {
      server = serve({ fetch: booted.app.fetch, port: 0 }, () => resolve());
      server.on('error', reject);
    });
    const address = server?.address();
    if (!address || typeof address === 'string') throw new Error('Gateway did not bind a local port.');
    const gateway = `http://127.0.0.1:${address.port}`;

    const proxy = await fetch(`${gateway}/v1/proxy`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shlita-api-key': agentKey,
        'x-shlita-simulation': 'true',
      },
      body: JSON.stringify({
        agentId: 'agent-local-settle',
        vendor: 'api.helius.xyz',
        estimatedCostMicroUsdc: '15000',
        method: 'POST',
        path: '/v0/token-metadata',
        body: { mints: ['local-test-mint'] },
        idempotencyKey: 'local-settle-01',
        simulate: true,
      }),
    });
    if (proxy.status !== 200) throw new Error(`Proxy failed ${proxy.status}: ${await proxy.text()}`);
    const operationId = proxy.headers.get('x-shlita-operation-id');
    if (!operationId) throw new Error('Proxy response did not return an operation id.');
    if (proxy.headers.get('x-shlita-spend-micro-usdc') !== AUTHORIZED.toString()) {
      throw new Error(`Accounted spend was ${proxy.headers.get('x-shlita-spend-micro-usdc')}, not ${AUTHORIZED}.`);
    }

    const sourceBefore = await tokenAmount(connection, source);
    const destinationBefore = await tokenAmount(connection, destination);
    const claim = await fetch(`${gateway}/v1/operations/${operationId}/settle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shlita-operator-key': 's'.repeat(40) },
      body: JSON.stringify({ destination: merchant.publicKey.toBase58(), amountMicroUsdc: AUTHORIZED.toString() }),
    });
    const claimed = (await claim.json()) as { status?: string; settlementId?: string; replay?: boolean; error?: string; message?: string };
    if (claim.status !== 200 || claimed.replay || claimed.status !== 'SETTLEMENT_PREPARED') {
      throw new Error(`Settlement claim failed ${claim.status}: ${JSON.stringify(claimed)}`);
    }

    const prepared = await manager.prepareSettlementTransaction(subscriber.publicKey, merchant.publicKey, AUTHORIZED, {
      allowanceMicroUsdc: allowanceBefore,
      expiryTs,
      nowTs: BigInt(Math.floor(Date.now() / 1000)),
      decimals: 6,
    });
    const submitted = await manager.submitSettlementTransaction(prepared, merchant);
    if (!submitted.signature || prepared.status !== 'SETTLEMENT_CONFIRMATION_PENDING') {
      throw new Error(`Broadcast did not leave a visible signature: ${submitted.error ?? 'unknown'}`);
    }
    const sourceAfter = await tokenAmount(connection, source);
    const destinationAfter = await tokenAmount(connection, destination);
    manager.observeBalances(prepared, { sourceBefore, sourceAfter, destinationBefore, destinationAfter });
    const allowanceAfter = await delegationRemaining(connection, delegation);
    if (allowanceBefore - allowanceAfter !== AUTHORIZED) {
      throw new Error(`Delegation allowance changed by ${allowanceBefore - allowanceAfter}, not ${AUTHORIZED}.`);
    }

    for (const status of ['SETTLEMENT_SUBMITTED', 'SETTLEMENT_CONFIRMATION_PENDING', 'SETTLEMENT_CONFIRMED'] as const) {
      const noted = booted.engine.noteChainSettlement(operationId, {
        status,
        signature: submitted.signature,
        slot: submitted.slot,
      });
      if (!noted.ok) throw new Error(`Ledger rejected ${status}: ${noted.message}`);
    }

    const sourceMid = await tokenAmount(connection, source);
    const retry = await fetch(`${gateway}/v1/operations/${operationId}/settle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shlita-operator-key': 's'.repeat(40) },
      body: JSON.stringify({ destination: merchant.publicKey.toBase58(), amountMicroUsdc: AUTHORIZED.toString() }),
    });
    const retried = (await retry.json()) as { replay?: boolean; signature?: string; status?: string; settlementId?: string; fundsMoved?: boolean; amountMicroUsdc?: string };
    const sourceFinal = await tokenAmount(connection, source);
    const destinationFinal = await tokenAmount(connection, destination);
    if (!retried.replay || retried.signature !== submitted.signature || retried.settlementId !== claimed.settlementId) {
      throw new Error(`Retry did not return the original settlement: ${JSON.stringify(retried)}`);
    }
    if (sourceFinal !== sourceMid || destinationFinal !== destinationAfter || sourceBefore - sourceFinal !== AUTHORIZED) {
      throw new Error('Retry moved tokens a second time.');
    }
    if (prepared.status !== 'SETTLEMENT_CONFIRMED' || retried.fundsMoved !== true || retried.status !== 'SETTLEMENT_CONFIRMED') {
      throw new Error(`Settlement was not confirmed in both the manager and the ledger: ${prepared.status} ${retried.status}`);
    }

    const status = await connection.getSignatureStatus(submitted.signature);
    console.log(JSON.stringify({
      result: 'PASS',
      programId: PROGRAM_ID,
      programSha256: programHash,
      programCommit: '364a41976c33347d092902443bbec2def9227e75',
      sdk: '@solana/subscriptions@0.5.0',
      mint: mint.toBase58(),
      decimals: 6,
      sourceBefore: sourceBefore.toString(),
      sourceAfter: sourceFinal.toString(),
      destinationBefore: destinationBefore.toString(),
      destinationAfter: destinationFinal.toString(),
      allowanceBefore: allowanceBefore.toString(),
      allowanceAfter: allowanceAfter.toString(),
      authorizedMicroUsdc: AUTHORIZED.toString(),
      enrollmentSignature,
      settlementSignature: submitted.signature,
      confirmationStatus: status.value?.confirmationStatus ?? null,
      executionError: status.value?.err ?? null,
      slot: submitted.slot ?? null,
      operationId,
      settlementId: claimed.settlementId,
      ledgerStatus: retried.status,
      replay: retried.replay,
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    if (logs.length > 0) console.error(logs.join('').slice(-4000));
    process.exitCode = 1;
  } finally {
    server?.close();
    child.kill('SIGKILL');
    try { fs.rmSync(ledger, { recursive: true, force: true }); } catch { /* validator may still be releasing the ledger */ }
    try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* temp state is outside the repo */ }
  }
  process.exit(process.exitCode ?? 0);
}

main();
