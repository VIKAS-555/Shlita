# Shlita — Step 10: Infrastructure, Container & SRE Review

**Phase:** Infrastructure & Deployment Assessment  
**Target:** Container Runtime, Persistent Storage, SRE Boundaries, CI/CD Pipeline  
**Status:** **PASS (Container Packaging & Persistence Verified; Single-Writer Invariant Required)**

---

## 1. Container Runtime Specification

The production container is defined in `Dockerfile`:

```dockerfile
# Multi-stage production build
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
RUN groupadd --gid 10001 shlita \
  && useradd --uid 10001 --gid 10001 --home-dir /var/lib/shlita --shell /usr/sbin/nologin shlita
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-ui ./dist-ui
COPY --from=build /app/package.json ./package.json
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p /var/lib/shlita/backups \
  && chown -R shlita:shlita /var/lib/shlita
ENV SHLITA_DB_PATH=/var/lib/shlita/ledger.db \
    SHLITA_STATE_DIR=/var/lib/shlita \
    SHLITA_BACKUP_DIR=/var/lib/shlita/backups \
    PORT=4000
EXPOSE 4000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/packages/gateway/src/index.js"]
```

### Key Security & Reliability Features:
1. **Non-Root Execution:** Runs under dedicated unprivileged user `shlita` (UID `10001`, GID `10001`) with login shell disabled (`/usr/sbin/nologin`).
2. **Deterministic Health Check:** Native Node.js `fetch` executes against `/ready` every 10 seconds. Returns 0 only if SQLite is initialized and accepts transactions.
3. **Graceful Shutdown:** Configured with `STOPSIGNAL SIGTERM`. The Fastify/Hono gateway listens for SIGTERM, finishes in-flight requests, and flushes SQLite WAL buffers to disk.

---

## 2. Storage & Single-Writer Invariant

### The SQLite Boundary
The persistence layer relies on `node:sqlite` directly interacting with a local database file (`/var/lib/shlita/ledger.db`).
- **Journal Mode:** Write-Ahead Logging (`PRAGMA journal_mode = WAL;`)
- **Busy Timeout:** `PRAGMA busy_timeout = 5000;` (5 seconds lock retry window)
- **Synchronous Mode:** `PRAGMA synchronous = FULL;`

> [!WARNING]
> **Single-Instance Constraint (SEV-1 Invariant):**
> SQLite does not support concurrent multi-process writes across network-attached filesystems (NFS, AWS EFS). Any orchestration configuration that launches multiple gateway replicas (e.g. `replicas > 1` in Kubernetes or AWS ECS) will corrupt the database file or induce frequent `SQLITE_BUSY` crashes.
> 
> **Operational Rule:** Shlita staging and production deployments must strictly enforce `replicas: 1` on a dedicated NVMe block volume.

---

## 3. Backup & Recovery Operations

1. **Online Non-Blocking Backups:** `packages/gateway/src/backup-cli.ts` invokes SQLite's native `VACUUM INTO` command, generating a consistent point-in-time snapshot while live transactions continue.
2. **Cryptographic Validation:** Backups compute an SHA-256 hash of the snapshot to detect silent bit rot.
3. **Safe Restore:** `packages/gateway/src/restore-cli.ts` verifies checksum integrity and **refuses to overwrite** an existing target database unless `--force` is explicitly provided.

---

## 4. CI/CD Automation Analysis

GitHub Actions workflow `.github/workflows/deploy.yml` enforces four automated gates on push to `main`:
1. **`build`:** Installs clean dependencies (`npm ci`), runs Vitest test matrix (98 tests), runs SDK external consumer check, and compiles frontend/backend.
2. **`image`:** Builds Docker image, executes container fail-closed production check, mounts a persistent volume, creates an agent, executes proxy transactions, restarts container, and asserts transaction persistence.
3. **`deploy`:** Deploys static Vite dashboard to GitHub Pages (`xiaoarnav.github.io/Shlita/`).
4. **`staging` (`Verify & Deploy Staging`):** Builds and pushes container to GitHub Container Registry (`ghcr.io/xiaoarnav/shlita-gateway:staging` and SHA tag), pulls the image, and verifies container execution (`node -v`).
