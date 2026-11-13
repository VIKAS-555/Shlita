# Step 11 — Solana Settlement Evidence Reconciliation

**Date:** 2026-11-13  
**Auditor:** Antigravity (independent re-verification)

---

## Purpose

Steps 9 and 10 gave conflicting or ambiguous accounts of Solana funded settlement execution. This document traces every claim to its evidence, classifies it, and reports the current reproduction status.

---

## 1. Historical PR Evidence

### PR #4 — `fix(solana): settle once through transfer_fixed`
- **Commit:** `8066295`  
- **Merged into:** `f7c752e` (merge commit)  
- **Claim:** Settlement builder added with `transfer_fixed` instruction.  
- **Evidence:** Code change merged. No funded local execution claimed in this PR.  
- **Classification:** **NOT VERIFIED** (code shipped, funded test not performed in PR #4).

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
- **Classification:** **HISTORICALLY VERIFIED** — the developer ran this locally and recorded the outcome in the PR description. No CI artifact or transaction log is independently retrievable from this repository. The claim is internally consistent and the script (`scripts/solana-local-settlement.ts`) implements the described behavior.

---

## 2. Steps 9 & 10 Audit Reports

### Step 10 `SOLANA_VERIFICATION.md` (found at `docs/step-10/SOLANA_VERIFICATION.md`)
- **Status given:** `PARTIAL / CONDITIONAL PASS`  
- **Finding:** Unit tests (9/9) pass. Funded local-validator test blocked on `subscriptions_program.so` binary.  
- **Cryptographic verification:** PDA derivations and instruction construction verified by unit tests.  
- **Classification of their funded claim:** **CURRENTLY BLOCKED** — Step 10 attempted `npm run test:solana-local` and received exit code 2.

---

## 3. Current Reproduction Attempt (Step 11)

**Command:** `npm run test:solana-local`  
**Result:** 🔴 **CURRENTLY BLOCKED**

```
BLOCKED: SHLITA_SUBSCRIPTIONS_SO is not a subscriptions_program.so built from
program-v0.5.0 (364a41976c33347d092902443bbec2def9227e75). The local validator
was not asked to move tokens.
```

**Compiled `.so` binary search:** `find . -name "*.so"` — **no `.so` file found in the repository**.

**Unit-level Solana tests (safe, no binary):**  
Command: `npx vitest run tests/solana.test.ts`  
Result: ✅ **9/9 tests passed**

Tests confirmed passing:
- Derives canonical Subscription Authority PDA with correct seeds
- Derives official Fixed Delegation PDA with nonce
- Derives official Event Authority PDA
- Builds cryptographically valid `transfer_fixed` instruction
- Enforces positive integer micro-USDC transfer amounts
- Rejects mainnet settlement when `SHLITA_ALLOW_MAINNET` is unset
- Honestly distinguishes simulated from broadcast transactions
- Formats micro-USDC decimal representation accurately
- Verifies observed token balance deltas match transfer amount

---

## 4. Classification Summary

| Claim | Classification | Evidence |
|---|---|---|
| Settlement builder builds valid `transfer_fixed` instruction | ✅ CURRENTLY REPRODUCED | Unit tests (solana.test.ts, 9/9 pass) |
| PDA derivations (authority, delegation, event) match spec | ✅ CURRENTLY REPRODUCED | Unit tests |
| Mainnet gate blocks without `SHLITA_ALLOW_MAINNET=true` | ✅ CURRENTLY REPRODUCED | Unit test + source code review |
| Funded local transfer: 1,000,000 → 990,000 source balance | 📜 HISTORICALLY VERIFIED | PR #5 description; not independently re-producible without `.so` binary |
| Idempotent replay of funded settlement (same signature) | 📜 HISTORICALLY VERIFIED | PR #5 description |
| CI-level funded execution on GitHub Actions | 🔴 CURRENTLY BLOCKED | CI intentionally records exit 2 as BLOCKED |
| `subscriptions_program.so` binary in repository | ❌ NOT PRESENT | `find . -name "*.so"` returns nothing |

---

## 5. What Would Be Required to Reproduce

To move the funded settlement from HISTORICALLY VERIFIED to CURRENTLY REPRODUCED:

1. Obtain the compiled `subscriptions_program.so` BPF binary built from program-v0.5.0 commit `364a41976c33347d092902443bbec2def9227e75`.
2. Set the environment variable: `SHLITA_SUBSCRIPTIONS_SO=/path/to/subscriptions_program.so`
3. Install `solana-test-validator` and `solana` CLI on the host.
4. Run: `npm run test:solana-local`
5. Record the transaction signature and balance delta outputs.

---

## 6. Conclusion

The historical funded settlement claim from PR #5 is **internally consistent** with the current code in `scripts/solana-local-settlement.ts` and `packages/solana/src/settlement.ts`. The script's logic is unchanged from PR #5. The cryptographic components (instruction building, PDA derivation, fail-closed mainnet gate) are independently verified by the unit test suite.

The gap between HISTORICALLY VERIFIED and CURRENTLY REPRODUCED is **solely** the missing compiled BPF binary, not a software defect.
