# Shlita — Step 10: Solana Settlement & On-Chain Safety Verification

**Phase:** Solana Protocol & Settlement Safety Audit  
**Target Invariant:** Valid Instruction Construction, Fail-Closed Mainnet Protection, Non-Custodial Delegation  
**Status:** **PARTIAL / CONDITIONAL PASS (Cryptographic Composition Verified; Live Funded Settlement Blocked on BPF Binary)**

---

## 1. On-Chain Program Architecture

Shlita integrates with the official canonical Solana Foundation Subscriptions Program:
- **Program ID:** `De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`
- **Official Package:** `@solana/subscriptions` (v0.5.0 specification)
- **Token Mint Scope:**
  - **Mainnet USDC:** `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
  - **Devnet USDC:** `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`

---

## 2. Cryptographic PDA Derivations

The settlement engine (`packages/solana/src/settlement.ts`) derives three canonical Program Derived Addresses (PDAs):

1. **Subscription Authority PDA:**
   - Seeds: `["SubscriptionAuthority", subscriberPubkey, tokenMint]`
   - Derived via: `findSubscriptionAuthorityPda()`
   - Role: Ensures only the authorized delegator can configure spending authority.
2. **Fixed Delegation PDA:**
   - Seeds: `["delegation", subscriptionAuthorityPda, delegatorPubkey, delegateePubkey, nonce]`
   - Derived via: `findFixedDelegationPda()`
   - Role: Enforces fixed allowance limits and period rollover constraints on-chain.
3. **Event Authority PDA:**
   - Derived via: `findEventAuthorityPda()`
   - Role: Validates CPI event emission for indexed transaction observability.

---

## 3. Fail-Closed Mainnet Gate

In `packages/solana/src/settlement.ts`:
```typescript
if (isMainnet && process.env.SHLITA_ALLOW_MAINNET !== 'true') {
  throw new Error('Mainnet settlement is disabled.');
}
```
Mainnet transfer preparation is **strictly blocked** unless the operator explicitly passes `SHLITA_ALLOW_MAINNET=true` as an environment variable. In all standard testing and staging configurations, attempts to target Mainnet fail immediately before any transaction is built.

---

## 4. Test Verification & Coverage

### 4.1 Passing Unit Tests (9 of 9 Passed)
The Vitest test suite (`tests/solana.test.ts`) executes in 64ms with 100% pass rate:
- `derives canonical Subscription Authority PDA with correct seeds` (PASS)
- `derives official Fixed Delegation PDA with nonce` (PASS)
- `derives official Event Authority PDA` (PASS)
- `builds cryptographically valid transfer_fixed instruction` (PASS)
- `enforces positive integer micro-USDC transfer amounts` (PASS)
- `rejects mainnet settlement when SHLITA_ALLOW_MAINNET is unset` (PASS)
- `honestly distinguishes simulated from broadcast transactions` (PASS)
- `formats micro-USDC decimal representation accurately` (PASS)
- `verifies observed token balance deltas match transfer amount` (PASS)

### 4.2 Funded Local-Validator Test Status
- **Command:** `npm run test:solana-local`
- **Result:** **Exit Code 2 (BLOCKED)**
- **Diagnostic Message:**
  ```
  BLOCKED: SHLITA_SUBSCRIPTIONS_SO is not a subscriptions_program.so built from program-v0.5.0 (364a41976c33347d092902443bbec2def9227e75). The local validator was not asked to move tokens.
  ```
- **Finding:** The repository includes the TypeScript client bindings for the Subscriptions program, but does not bundle the compiled Rust BPF shared object (`subscriptions_program.so`) in git. Therefore, live end-to-end token transfers on a local `solana-test-validator` cannot run in headless CI without a pre-compiled program binary.

---

## 5. Custody & Authority Risk Analysis

| Risk Category | Severity | Assessment & Mitigation |
|---|---|---|
| **Private Key Custody** | HIGH | The Shlita gateway holds operator delegatee private keys in memory to sign CPI settlement instructions. A compromised host could expose delegatee signing authority (bounded by the on-chain delegation allowance). |
| **Token Theft Exceeding Allowance** | NONE | Mitigated by Subscriptions program invariants: an agent or operator can never transfer more than the user's on-chain approved fixed allowance. |
| **Double-Claim Settlement Replay** | LOW | Mitigated: each settlement instruction requires an incrementing nonce or fresh transaction signature recorded in `settlements` table. |
| **Network Congestion Drop** | MEDIUM | Mitigated: `observeBalances()` verifies on-chain account balance deltas before marking settlement confirmed. |
