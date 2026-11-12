# Shlita developer quickstart

Shlita is a gateway in front of paid provider calls. An agent presents its API key. The gateway checks the agent's policy, reserves the server tariff, and either dispatches the call or records a rejection. The ledger is the record of that decision.

Shlita does not host a public API. It does not hold your provider secret in the SDK. It does not move USDC because a proxy call returned 200. A committed proxy row has `fundsMoved: false` and `settlement.status: NOT_SUBMITTED` until a separate confirmed settlement exists. Estimated holds are not vendor invoices.

## Run a gateway

Node.js 22 or newer.

```bash
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:4000`. Development can create an operator key under `.shlita/` and does not print it. Set `SHLITA_OPERATOR_KEY` yourself when you want a known credential. `SHLITA_ALLOW_SIMULATION=true` is a development switch. Production rejects simulation, demo enrollment, and an in-memory database.

Docker is the same process with a volume:

```bash
docker build -t shlita:local .
docker compose up
```

`compose.yaml` maps port 4010 and stores the ledger on the `shlita-data` volume. One container is the supported deployment. A second writer is not.

## Enroll an agent

From a trusted backend, with `ShlitaOperatorClient` or `POST /v1/agents` and `x-shlita-operator-key`:

- `agentId`: 3–80 characters from letters, numbers, `.`, `_`, `~`, `-`
- `allowedVendors`: provider hosts, such as `api.helius.xyz`
- `maxPerCallMicroUsdc` and `periodBudgetMicroUsdc`: positive integer strings

The response includes `apiKey` once. Store it outside the browser. The operator key stays on the backend. The dashboard session cookie is HttpOnly and is not an SDK credential.

## Install the SDK

`shlita-sdk` is not on the npm registry. From this repository:

```bash
npm run build:sdk
cd packages/sdk
npm pack --pack-destination /tmp/shlita-sdk
```

In the other project:

```bash
npm install /tmp/shlita-sdk/shlita-sdk-0.1.0.tgz
```

The archive contains `dist/*.js`, `dist/*.d.ts`, `README.md`, and `package.json`. It does not contain the gateway, the ledger, or TypeScript implementation source.

## First call

```typescript
import { ShlitaAgentClient } from 'shlita-sdk';

const shlita = new ShlitaAgentClient({
  apiKey: process.env.SHLITA_API_KEY!,
  baseUrl: process.env.SHLITA_GATEWAY_URL!,
});

const result = await shlita.proxy({
  agentId: 'research-agent',
  vendor: 'api.helius.xyz',
  method: 'POST',
  path: '/v0/token-metadata',
  body: { mints: ['example-mint'] },
  idempotencyKey: 'operation-unique-id',
});
```

`simulate: true` is for a gateway started with `SHLITA_ALLOW_SIMULATION=true`. Production returns 403 `SIMULATION_DISABLED`.

Read `result.outcome`:

- `committed`: the server tariff was reserved. `cost.reservedAmountMicroUsdc` is that tariff. `cost.actualCostMicroUsdc` is null. `fundsMoved` is false.
- `rejected`: policy, authentication, or simulation stopped the call. `reason` names the rule, such as `UNAPPROVED_VENDOR`, `PER_CALL_LIMIT_EXCEEDED`, or `AGENT_FROZEN`.
- `conflict`: the idempotency key was reused for a different payload (`IDEMPOTENCY_CONFLICT`) or the first call is still in progress (`OPERATION_IN_PROGRESS`).
- `uncertain`: the gateway answered 504 or marked the operation for reconciliation. The provider might have run. Do not send a new key.

A thrown `ShlitaUncertainError` means the SDK sent the request once and received no usable response (`TIMEOUT`, `NETWORK`, or `CANCELLED`). That is not a definite provider failure. Call `proxy` again with the same key and the same payload when you want the gateway to return the stored result. The SDK does not do that by itself.

## Policies, freeze, and operations

`ShlitaOperatorClient` sends `x-shlita-operator-key`. It is the administration client: enroll, list, freeze, unfreeze, reset the circuit, read operations, the dashboard, audit, and reconciliation. An agent key cannot construct those calls. Caller-supplied `authorization`, cookie, agent key, and operator key headers are removed before the SDK sets its own credential.

Amounts are micro-USDC strings. `10000` is `0.010000` USDC. The Helius server tariff used by the gateway is `10000` micro-USDC. A caller estimate does not raise that reservation.

`examples/basic-agent`, `examples/policy`, `examples/idempotency`, and `examples/tool-adapter` are the runnable versions of these cases. The tool adapter is a small function schema with an `execute` method. It is not a framework integration.

## Settlement

A proxy success is an estimated hold. Chain settlement is a separate operator request, `POST /v1/operations/{operationId}/settle`. The current gateway records a claim and does not broadcast a transaction. `signature` stays null. Mainnet stays off unless the gateway process is explicitly configured with both `SHLITA_ALLOW_MAINNET=true` and `SOLANA_NETWORK=mainnet-beta`.

## Errors

| What you see | What it means |
| --- | --- |
| `A gateway URL is required` | `baseUrl` was missing or not `http`/`https`. |
| `An API key is required` or `An operator key is required` | The credential was empty or outside the accepted character set. |
| `A billable request requires an idempotency key` | The key was missing or shorter than 8 characters. |
| HTTP 401 | The credential was absent. |
| HTTP 403 | The credential, organization, origin, or policy rejected the call. |
| HTTP 409 | Same key, different request, or the first request is still open. |
| HTTP 429 | The login or operator mutation limit was hit. |
| HTTP 504 or `ShlitaUncertainError` | Outcome unknown. Reuse the key. Do not invent a new one. |

## Limits

- One gateway process and one SQLite file. Sessions live in that process, so a restart asks the operator to sign in again. Login lockouts and ledger rows remain.
- No public hosted gateway has been verified. Vercel and GitHub Pages serve the static interface only.
- Mainnet payments are off by default.
- A simulated or estimated provider response is not a USDC settlement and is not the vendor's invoice.
- Uncertain operations stay visible on `GET /v1/reconciliation` for an authorized operator.
