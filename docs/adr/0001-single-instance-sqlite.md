# 0001. One gateway, one SQLite file

## Status

Accepted

## Context

Shlita's ledger is a single SQLite database. The hosted Vercel and GitHub Pages sites serve the static interface only. They do not run the gateway and they do not keep financial records. Operator sessions currently live in the gateway process. Login lockouts have to survive a restart. More than one process writing the same SQLite file is not supported.

## Decision

Run one gateway process with the ledger on a persistent volume. Do not add another database engine for this deployment.

- The production and staging configuration refuses an in-memory ledger.
- The container starts as root only long enough to give uid 10001 ownership of `/var/lib/shlita`, then the gateway process runs as that user.
- `SIGTERM` marks the process unready, stops listening, and closes the database.
- Sessions stay in process memory. A restart requires the operator to sign in again. That is the supported behavior, not a second instance sharing sessions.
- Login failures are rows in the ledger, so a restart does not clear a lockout.
- Forwarded client addresses are ignored unless the immediate peer is listed in `SHLITA_TRUSTED_PROXIES`.
- Backups use SQLite's backup API and are restored only after `PRAGMA integrity_check`.
- Horizontal scaling is not supported. Do not run two writers against the same file.

## Consequences

A process restart drops operator sessions and in-memory mutation counters. Financial rows, audit events, and login lockouts remain. An uncertain in-flight operation is marked for reconciliation and is not sent to a provider or a chain again. Mainnet settlement and simulation stay off in production and staging. A public HTTPS host for this gateway is not part of this repository's deploy workflow.
