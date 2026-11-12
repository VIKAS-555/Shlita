# Shlita Remaining Pilot & Release Blockers

**Document Reference:** `docs/step-8/REMAINING_BLOCKERS.md`  
**Parent Milestone:** Step 8 — Pilot Deployment Blueprint & Release-Gate Closure  
**Baseline Git Commit:** `4d461c5b1edb63db802674c4cb827a91b211627a`  

---

## 1. Blocker Inventory & Severity Categorization

The following blockers currently prevent immediate open pilot rollout. Each blocker is classified with its root cause, architectural impact, concrete remediation steps, and verifiable acceptance criteria.

---

### Category A: Critical Launch Blockers (Must Resolve Before Any External Traffic)

#### `BLOCKER-CRIT-01`: Absence of Live HTTPS Staging Gateway
- **Severity:** **CRITICAL (SEV-1 Blocker)**
- **Root Cause:** The existing production deployment at `https://shlita.vercel.app/` hosts only the static Vite frontend. The backend gateway container (`packages/gateway`) is only executed in local development or ephemeral CI runner containers. There is no publicly reachable HTTPS API endpoint.
- **Architectural Impact:** External AI agent developers cannot connect their agents or SDK clients without manually pulling the Docker image and hosting the server themselves.
- **Remediation Action Plan:**
  1. Provision single cloud VM instance (Ubuntu 24.04 LTS, 2 vCPU, 4GB RAM, 50GB NVMe).
  2. Configure Caddy web server with automated Let's Encrypt TLS termination for a public FQDN (e.g. `gateway.staging.shlita.xyz`; public Let's Encrypt cannot issue for `.internal`).
  3. Deploy Shlita Gateway via Docker Compose with dedicated persistent volume mount for `/var/lib/shlita/data`.
- **Acceptance Criteria:**
  ```bash
  curl -s -I https://gateway.staging.shlita.xyz/ready
  # MUST return HTTP/2 200 OK with valid TLS certificate chain (polled on /ready).
  ```

#### `BLOCKER-CRIT-02`: Single-Writer SQLite Concurrency Bottleneck
- **Severity:** **CRITICAL (Architectural Boundary)**
- **Root Cause:** The persistence engine relies on `node:sqlite` directly interacting with a local file in WAL mode. File-level write locks prevent horizontal container replication (e.g. Kubernetes multi-pod deployments sharing an NFS or EFS drive will experience corruptions or `SQLITE_BUSY`).
- **Architectural Impact:** The staging deployment must run strictly as a **single container instance**. Any autoscaling policy will corrupt the database.
- **Remediation Action Plan:**
  1. Enforce `replicas: 1` in all container orchestrator manifests.
  2. Pin container to a local high-performance NVMe volume rather than network-attached storage.
  3. (Post-Pilot Future Milestone): Design migration path to distributed consensus (e.g. Litestream or PostgreSQL backend) if horizontal multi-region scaling is required.
- **Acceptance Criteria:** Docker Compose or ECS task definition strictly enforces `deploy.replicas = 1`.

---

### Category B: High-Priority Operational Blockers (Must Resolve for Safe Pilot Monitoring)

#### `BLOCKER-HIGH-01`: Unhosted Telemetry & Alert Sink (Gate 11)
- **Severity:** **HIGH**
- **Root Cause:** Gateway logs are emitted to standard output (`stdout`) as structured JSON, but no log forwarder or telemetry daemon (Prometheus / Grafana Loki / Datadog) is scraping the container.
- **Architectural Impact:** If an agent triggers an error burst or runaway transaction loop during non-business hours, SREs will not receive automated PagerDuty or Slack alerts until manually inspecting the container.
- **Remediation Action Plan:**
  1. Deploy lightweight Vector or Promtail sidecar to tail Docker container logs.
  2. Configure alert thresholds:
     - Spend rate > $10 / hour -> Alert SRE
     - Circuit breaker trips -> PagerDuty Sev-2
     - Database disk usage > 80% -> Alert Ops
- **Acceptance Criteria:** Synthetic generation of 5 consecutive 500 errors triggers an active webhook alert in `#incident-shlita-pilot`.

#### `BLOCKER-HIGH-02`: Manual Operator Credential Provisioning
- **Severity:** **HIGH**
- **Root Cause:** There is no self-service dashboard or automated OAuth/Stripe onboarding flow. All agent API keys and organization policies must be inserted manually by an operator via curl commands or database migrations.
- **Architectural Impact:** Slow partner onboarding; operator error risk when manually generating hashed tokens.
- **Remediation Action Plan:**
  1. Provide automated onboarding bash script `scripts/ops/provision-partner.sh` that securely generates random tokens, writes database rows, and outputs a formatted partner envelope.
  2. Implement operator CLI tool for rapid credential generation.
- **Acceptance Criteria:** Operator can onboard a new agent in < 60 seconds with a single deterministic command.

---

### Category C: Medium-Priority Architectural Improvements

#### `BLOCKER-MED-01`: Manual Solana Settlement Reconciler
- **Severity:** **MEDIUM**
- **Root Cause:** While Solana PDA derivations and settlement transaction builders are fully implemented and tested, the background reconciliation daemon that sweeps uncommitted Solana settlement slots runs synchronously during test suites rather than as a decoupled cron worker.
- **Architectural Impact:** In Devnet network congestion, unconfirmed transactions could accumulate in the local queue without automated background retry.
- **Remediation Action Plan:**
  1. Formalize background queue runner in `packages/solana` to drain pending settlement queues every 60 seconds.
  2. Add exponential backoff on Devnet RPC rate limits (HTTP 429).
- **Acceptance Criteria:** Background worker independently settles batches of pending ledger entries every minute and records signatures.

#### `BLOCKER-MED-02`: Upstream Latency Variance Under Real LLMs
- **Severity:** **MEDIUM**
- **Root Cause:** Unit and integration tests rely primarily on `mock-llm` which responds within 5–15ms. Real OpenAI/Anthropic API calls frequently encounter latencies of 1,200ms–8,000ms.
- **Architectural Impact:** Holding SQLite transactions open during slow upstream network calls could lead to lock contention. (Note: Shlita's 2-phase reserve-then-settle pattern avoids holding DB locks during proxy egress, but needs real-world network latency validation).
- **Remediation Action Plan:** Run Phase 6 latency tests against live OpenAI Dev endpoints before pilot opening.
- **Acceptance Criteria:** Gateway processes concurrent 3-second streaming completions with zero SQLite lock timeouts.

---

### Category D: Low-Priority Documentation & Polish Items

#### `BLOCKER-LOW-01`: Standalone SDK Quickstart Package Registry
- **Severity:** **LOW**
- **Root Cause:** The package `shlita-sdk` is private and packages cleanly via `npm pack`, but is not published to public npm.
- **Remediation Action Plan:** Publish versioned tarball `shlita-sdk-0.1.0.tgz` to GitHub Releases for pilot partners.
- **Acceptance Criteria:** Partner can run `npm install ./shlita-sdk-0.1.0.tgz` or install directly from release asset URL.
