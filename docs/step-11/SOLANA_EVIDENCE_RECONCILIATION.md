# Step 11 — Solana Settlement Evidence Reconciliation

**Date:** 2026-11-13  
**Auditor:** Antigravity (independent re-verification)

---

## Purpose

Steps 9 and 10 gave ambiguous accounts of Solana funded settlement execution. In particular, the Step 9 staging report stated that "Solana funded execution is verified through CI evidence only", whereas the CI workflow (`.github/workflows/deploy.yml`) explicitly prints:
`Funded local-validator settlement: BLOCKED. npm test did not move tokens.` (exit code 2).

This document traces every claim to its primary source, reconciles the discrepancies, labels the historical evidence accurately, and reports the current reproduction status.

---

## 1. Historical PR Evidence

### PR #4 — `fix(solana): settle once through transfer_fixed`
- **Commit:** `8066295` (Merge commit `f7c752e`)
- **Claim:** Settlement builder added with `transfer_fixed` instruction.
- **Evidence:** Code change merged. No funded local execution claimed in this PR.
- **Classification:** **NOT VERIFIED** (code merged; funded test not performed in PR #4).

### PR #5 — `fix(solana): prove one local transfer_fixed settlement`
- **Commit:** `e478d9a8ad1f6d19a926372810abe4a825b63730`
- **Date:** 2026-11-12T03:34:45+0530
- **Author:** `XiaoArnav <322868724+XiaoArnav@users.noreply.github.com>`
- **Claim from PR description:**
  - `npm run test:solana-local` loaded `subscriptions_program.so` from program-v0.5.0 (`364a41976c33347d092902443bbec2def9227e75`) with `solana-test-validator`
  - Created 6-decimal test mint
  - Settled 10,000 micro-units once through Shlita
  - Source balance: 1,000,000 → 990,000
  - Destination balance: 0 → 10,000
  - Allowance: 50,000 → 40,000
  - Signature confirmed; ledger state: `SETTLEMENT_CONFIRMED`
  - Retry of same operation returned original signature (idempotent, no second transfer)
  - `npm test`: 74 passed
  - CI on this commit: **BLOCKED** (binary not installed on GitHub Actions runner)
- **Classification:** **HISTORICALLY REPORTED** — The PR #5 description is the sole record of this run. No transaction signature artifact, on-chain log, or persistent ledger dump was preserved in the git tree. The TypeScript script (`scripts/solana-local-settlement.ts`) exists and implements the exact assertions described.

---

## 2. Reconciliation with Step 9 Staging Report

The Step 9 Staging Report (`docs/step-9/STAGING_VERIFICATION.md`) summarized:
> *"Solana funded execution is verified through CI evidence only"*

**Correction & Fact-Check:**
Inspection of GitHub Actions workflow `.github/workflows/deploy.yml` and actual CI run logs reveals:
```bash
set +e
npm run test:solana-local
status=$?
set -e
if [ "$status" -eq 0 ]; then
  echo "Funded local-validator settlement executed."
elif [ "$status" -eq 2 ]; then
  echo "Funded local-validator settlement: BLOCKED. npm test did not move tokens."
else
  exit "$status"
fi
```
In all CI runs from PR #5 up to PR #11, `npm run test:solana-local` exited with status `2` on the GitHub Actions runner because the BPF binary was not present. CI recorded this as **BLOCKED**, not as verified funded settlement.

Therefore, the claim that CI verified funded token movement was a wording error in Step 9. CI verified only that the script fails closed with exit code 2 when the binary is absent.

---

## 3. Current Reproduction Attempt (Step 11)

### A. Unit-Level Cryptographic Logic (Separate from Funded Execution)
- **Command:** `npx vitest run tests/solana.test.ts`
- **Result:** ✅ **9 of 9 passed (59ms)**
- **Verified Invariants:**
  - Derives canonical Subscription Authority PDA with correct seeds
  - Derives official Fixed Delegation PDA with nonce
  - Derives official Event Authority PDA
  - Builds cryptographically valid `transfer_fixed` instruction
  - Enforces positive integer micro-USDC transfer amounts
  - Rejects mainnet settlement when `SHLITA_ALLOW_MAINNET` is unset
  - Honestly distinguishes simulated from broadcast transactions
  - Formats micro-USDC decimal representation accurately
  - Verifies observed token balance deltas match transfer amount
- **Classification:** **CURRENTLY REPRODUCED**

### B. Funded Local-Validator Execution
- **Command:** `npm run test:solana-local`
- **Exit Code:** 2
- **Diagnostic Message:**
  ```text
  BLOCKED: SHLITA_SUBSCRIPTIONS_SO is not a subscriptions_program.so built from
  program-v0.5.0 (364a41976c33347d092902443bbec2def9227e75). The local validator
  was not asked to move tokens.
  ```
- **Prerequisite Check:** Search for `*.so` files in repository yields 0 results.
- **Classification:** 🔴 **CURRENTLY BLOCKED**

---

## 4. Reconciled Classification Register

| Claim | Source | Status / Classification | Evidence |
|---|---|---|---|
| Valid instruction generation & PDA math | `settlement.ts`, `solana.test.ts` | ✅ **CURRENTLY REPRODUCED** | 9 unit tests pass (59ms) |
| Fail-closed mainnet protection gate | `settlement.ts`, `solana.test.ts` | ✅ **CURRENTLY REPRODUCED** | Unit test throws without env |
| Funded local transfer (1,000,000 → 990,000) | PR #5 description | 📜 **HISTORICALLY REPORTED** | Author-reported in PR #5; no binary in repo |
| Replay protection returning same signature | PR #5 description | 📜 **HISTORICALLY REPORTED** | Author-reported in PR #5 |
| CI runner verification of token movement | Step 9 report | ❌ **CONTRADICTED** | CI explicitly logs BLOCKED (exit 2) |
| Current funded local execution | Step 11 execution | 🔴 **CURRENTLY BLOCKED** | Exits 2; missing `.so` binary |

---

## 5. Requirements for Complete Reproduction in Future Steps

To execute the funded settlement in CI or locally in Step 12+:
1. Build `subscriptions_program.so` from Solana Foundation Subscriptions repo commit `364a41976c33347d092902443bbec2def9227e75`.
2. Stage the binary in CI or supply via `SHLITA_SUBSCRIPTIONS_SO`.
3. Provide `solana-test-validator` in the CI image.
4. Execute `npm run test:solana-local` and capture on-chain transaction signature and delta balance output.
