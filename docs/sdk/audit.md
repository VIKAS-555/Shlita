# SDK audit before the package split

Confirmed against main `a43a338` before this branch changed the client.

1. The root `package.json` is `"private": true`, so `npm install shlita` is not a supported install.
2. Its `exports` pointed at TypeScript source (`packages/core/src/index.ts` and the gateway source).
3. `packages/core/src/index.ts` exported the client together with the SQLite ledger and policy engine.
4. `ShlitaClient` used `http://localhost:4000` when `baseUrl` was omitted.
5. The root export `./solana` pointed at `packages/solana/src/index.ts`, and that file did not exist.
6. `ProxyResponse<T = any>` and `freeze(): Promise<any>` did not describe committed, rejected, conflict, or uncertain results.
7. The README showed `import { ShlitaClient } from 'shlita'` and a 25-test badge. Neither described an installable archive.
8. No test installed a packed client outside this repository.
9. `proxy()` copied caller headers after `x-shlita-api-key`, so a caller could replace the agent credential or attach an operator key to the gateway request.

The public client is now `packages/sdk` (`shlita-sdk`). It compiles to `dist/`, ships no gateway or ledger source, and requires an explicit gateway URL. Agent and operator credentials are separate classes. Caller authentication headers are dropped. The root package stays private. `packages/solana/src/index.ts` now matches the existing `./solana` export.
