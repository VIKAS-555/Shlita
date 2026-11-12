# shlita-sdk

Client for a Shlita gateway you run yourself.

This package is private. Install the archive produced by `npm pack` in `packages/sdk`. It is not published to npm.

```typescript
import { ShlitaAgentClient } from 'shlita-sdk';

const shlita = new ShlitaAgentClient({
  apiKey: process.env.SHLITA_API_KEY!,
  baseUrl: process.env.SHLITA_GATEWAY_URL!,
});
```

Agent keys belong in a trusted process. Operator keys belong in a separate `ShlitaOperatorClient` on a trusted backend. The setup guide is `docs/sdk/quickstart.md`.
