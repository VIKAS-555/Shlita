import React, { useCallback, useEffect, useState } from 'react';
import { formatMicroUsdc } from '../../packages/core/src/money.js';

type Session = { organizationId: string; csrfToken: string; expiresAt: number };
type AgentRow = {
  agentId: string;
  status: string;
  organizationId: string;
  credentialStatus: string;
  freezeReason?: string;
  spending: {
    currentPeriodSpendMicroUsdc: string;
    periodBudgetMicroUsdc: string;
    activePendingReservationsMicroUsdc: string;
  };
  policy: { allowedVendors: string[] };
};
type OperationRow = {
  operationId: string;
  agentId: string;
  vendor: string;
  decision: string | null;
  estimatedCostMicroUsdc: string;
  reservedAmountMicroUsdc: string;
  actualCostMicroUsdc: string | null;
  costBasis: string;
  state: string;
  settlementStatus: string;
  signature: string | null;
  cluster: string | null;
  createdAt: number;
};
type TelemetryEvent = {
  id: string;
  timestamp: string;
  type: string;
  statusCode: number;
  agent: string;
  vendor: string;
  amountUsdc: number;
  latencyMs: number;
  details?: { reason?: string; reservationId?: string };
};
type Dashboard = {
  generatedAt: string;
  source: string;
  agents: { total: number; active: number; frozen: number; circuitTripped: number };
  accountedSpendMicroUsdc: string;
  pendingReservationsMicroUsdc: string;
  blocked: number;
  failed: number;
  reconciliation: number;
  settlement: Record<string, number>;
  spendByVendor: Record<string, { microUsdc: string; formatted: string }>;
};

const apiBase = (import.meta.env.VITE_SHLITA_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function money(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return formatMicroUsdc(value);
  } catch {
    return 'unavailable';
  }
}

function explorer(signature: string | null, cluster: string | null): string | null {
  if (!signature || !/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(signature)) return null;
  if (cluster === 'devnet') return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  if (cluster === 'mainnet-beta') return `https://explorer.solana.com/tx/${signature}`;
  return null;
}

export const LiveControlPlane: React.FC = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [operatorKey, setOperatorKey] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [operations, setOperations] = useState<OperationRow[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetryEvent[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async (csrfToken: string, organizationId: string, expiresAt: number) => {
    setSession({ csrfToken, organizationId, expiresAt });
    const [agentRes, operationRes, dashRes, telRes] = await Promise.all([
      request('/v1/agents'),
      request('/v1/operations'),
      request('/v1/dashboard'),
      request('/v1/telemetry'),
    ]);
    if (agentRes.status === 401) {
      setSession(null);
      return;
    }
    if (!agentRes.ok || !operationRes.ok || !dashRes.ok) {
      setOffline(true);
      return;
    }
    setOffline(false);
    setAgents((await agentRes.json()).agents);
    setOperations((await operationRes.json()).operations);
    setDashboard(await dashRes.json());
    if (telRes.ok) {
      setTelemetry((await telRes.json()).events || []);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await request('/v1/session');
        if (!active) return;
        if (response.status === 401) {
          setSession(null);
          return;
        }
        const body = await response.json();
        if (body.csrfToken) await load(body.csrfToken, body.organizationId, body.expiresAt);
      } catch {
        if (active) setOffline(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [load]);

  // Live polling: refresh ledger, telemetry events, and spend figures without requiring manual page reload
  useEffect(() => {
    if (!session) return;
    const interval = setInterval(() => {
      void load(session.csrfToken, session.organizationId, session.expiresAt);
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, [session, load]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setLoginError('');
    setBusy(true);
    try {
      const response = await request('/v1/session', { method: 'POST', body: JSON.stringify({ operatorKey }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLoginError(body.message || 'Sign-in failed.');
        return;
      }
      setOperatorKey('');
      await load(body.csrfToken, body.organizationId, body.expiresAt);
    } catch {
      setLoginError('The gateway is not reachable.');
      setOffline(true);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!session) return;
    await request('/v1/session/logout', { method: 'POST', headers: { 'x-shlita-csrf': session.csrfToken } });
    setSession(null);
    setAgents([]);
    setOperations([]);
    setDashboard(null);
    setIssuedKey(null);
    setTelemetry([]);
  }

  async function mutate(path: string, body?: unknown) {
    if (!session) return;
    setBusy(true);
    setActionError('');
    try {
      const response = await request(path, {
        method: 'POST',
        headers: { 'x-shlita-csrf': session.csrfToken },
        body: JSON.stringify(body ?? {}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setActionError(payload.message || 'The gateway rejected the action.');
        return;
      }
      if (payload.apiKey) setIssuedKey(payload.apiKey);
      await load(session.csrfToken, session.organizationId, session.expiresAt);
    } catch {
      setActionError('The gateway is not reachable. No local success was recorded.');
      setOffline(true);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <Shell><p className="text-sm text-text-muted">Checking the operator session…</p></Shell>;
  }

  if (!session) {
    return (
      <Shell>
        <form onSubmit={signIn} className="max-w-md mx-auto bg-card border border-border rounded-2xl p-6 space-y-4">
          <div>
            <h1 className="text-xl font-bold">Operator sign-in</h1>
            <p className="text-xs text-text-muted mt-1">The key is checked by the gateway and is not stored in this browser.</p>
          </div>
          {offline && <p className="text-xs text-rose-400">The gateway is unavailable. Live records are not being replaced with sample data.</p>}
          {loginError && <p className="text-xs text-rose-400">{loginError}</p>}
          <label className="block text-xs text-text-muted">
            Operator key
            <input
              type="password"
              autoComplete="current-password"
              value={operatorKey}
              onChange={(event) => setOperatorKey(event.target.value)}
              className="mt-1 w-full bg-background border border-border rounded-xl px-3 py-2 text-sm"
            />
          </label>
          <button disabled={busy || operatorKey.length < 16} className="bg-solana text-black text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-50">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <a className="block text-xs text-text-muted underline" href="?demo=1">Open the labeled demo instead</a>
        </form>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Live ledger</h1>
          <p className="text-xs text-text-muted">Organization {session.organizationId}. Source: {dashboard?.source ?? 'ledger'}. Freshness: {dashboard?.generatedAt ?? 'unavailable'}.</p>
        </div>
        <button onClick={signOut} className="text-xs border border-border rounded-xl px-3 py-2">Sign out</button>
      </div>
      {offline && <p className="text-xs text-rose-400">The gateway failed while refreshing. These figures were not replaced with sample data.</p>}
      {actionError && <p className="text-xs text-rose-400">{actionError}</p>}
      {issuedKey && (
        <p className="text-xs font-mono break-all bg-card border border-border rounded-xl p-3">
          Copy this agent key now. It will not be shown again: {issuedKey}
        </p>
      )}

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Agents" value={String(dashboard?.agents.total ?? 0)} />
        <Metric label="Active" value={String(dashboard?.agents.active ?? 0)} />
        <Metric label="Frozen" value={String(dashboard?.agents.frozen ?? 0)} />
        <Metric label="Accounted USDC" value={money(dashboard?.accountedSpendMicroUsdc)} />
        <Metric label="Pending reservations" value={money(dashboard?.pendingReservationsMicroUsdc)} />
        <Metric label="Blocked" value={String(dashboard?.blocked ?? 0)} />
        <Metric label="Failed" value={String(dashboard?.failed ?? 0)} />
        <Metric label="Needs reconciliation" value={String(dashboard?.reconciliation ?? 0)} />
      </section>

      <section className="bg-card border border-border rounded-2xl p-4 space-y-3">
        <h2 className="font-semibold text-sm">Agents</h2>
        {agents.length === 0 && <p className="text-xs text-text-muted">No agents are enrolled for this organization.</p>}
        <form
          className="grid md:grid-cols-4 gap-2 text-xs"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void mutate('/v1/agents', {
              agentId: String(form.get('agentId') ?? ''),
              allowedVendors: [String(form.get('vendor') ?? '')],
              maxPerCallMicroUsdc: String(form.get('perCall') ?? ''),
              periodBudgetMicroUsdc: String(form.get('budget') ?? ''),
            });
            event.currentTarget.reset();
          }}
        >
          <input name="agentId" required placeholder="agent id" className="bg-background border border-border rounded-lg px-2 py-2" />
          <input name="vendor" required placeholder="api.helius.xyz" className="bg-background border border-border rounded-lg px-2 py-2" />
          <input name="perCall" required placeholder="per-call micro-USDC" className="bg-background border border-border rounded-lg px-2 py-2" />
          <input name="budget" required placeholder="period budget micro-USDC" className="bg-background border border-border rounded-lg px-2 py-2" />
          <button disabled={busy} className="md:col-span-4 bg-solana text-black font-semibold rounded-lg px-3 py-2 disabled:opacity-50">Enroll agent</button>
        </form>
        <ul className="space-y-2">
          {agents.map((agent) => (
            <li key={agent.agentId} className="border border-border rounded-xl p-3 text-xs space-y-2">
              <div className="flex justify-between gap-3">
                <span className="font-mono">{agent.agentId}</span>
                <span>{agent.status}</span>
              </div>
              <p>Org {agent.organizationId}. Credential {agent.credentialStatus}. Providers {agent.policy.allowedVendors.join(', ') || 'none'}.</p>
              <p>Accounted {money(agent.spending.currentPeriodSpendMicroUsdc)} of {money(agent.spending.periodBudgetMicroUsdc)}. Pending {money(agent.spending.activePendingReservationsMicroUsdc)}.</p>
              {agent.freezeReason && <p>Freeze reason: {agent.freezeReason}</p>}
              <div className="flex gap-2">
                <button disabled={busy} onClick={() => mutate(`/v1/agents/${agent.agentId}/freeze`, { reason: 'Operator freeze' })} className="border border-border rounded-lg px-2 py-1">Freeze</button>
                <button disabled={busy} onClick={() => mutate(`/v1/agents/${agent.agentId}/unfreeze`)} className="border border-border rounded-lg px-2 py-1">Unfreeze</button>
                <button disabled={busy} onClick={() => mutate(`/v1/agents/${agent.agentId}/reset-circuit`)} className="border border-border rounded-lg px-2 py-1">Reset circuit</button>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-text-muted">Policy editing, multisig approval, subscription billing, and settings sync are not available. Those controls do not write to the ledger.</p>
      </section>

      <section className="bg-card border border-border rounded-2xl p-4 space-y-3">
        <h2 className="font-semibold text-sm">Financial operations</h2>
        {operations.length === 0 && <p className="text-xs text-text-muted">No financial operations are stored for this organization.</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-text-muted">
              <tr>
                <th className="py-1 pr-2">Operation</th>
                <th className="py-1 pr-2">Agent</th>
                <th className="py-1 pr-2">Provider</th>
                <th className="py-1 pr-2">Decision</th>
                <th className="py-1 pr-2">Estimated</th>
                <th className="py-1 pr-2">Reserved</th>
                <th className="py-1 pr-2">Verified</th>
                <th className="py-1 pr-2">State</th>
                <th className="py-1 pr-2">Settlement</th>
                <th className="py-1">Signature</th>
              </tr>
            </thead>
            <tbody>
              {operations.map((operation) => {
                const href = explorer(operation.signature, operation.cluster);
                return (
                  <tr key={operation.operationId} className="border-t border-border">
                    <td className="py-2 pr-2 font-mono">{operation.operationId}</td>
                    <td className="py-2 pr-2">{operation.agentId}</td>
                    <td className="py-2 pr-2">{operation.vendor}</td>
                    <td className="py-2 pr-2">{operation.decision ?? '—'}</td>
                    <td className="py-2 pr-2">{money(operation.estimatedCostMicroUsdc)}</td>
                    <td className="py-2 pr-2">{money(operation.reservedAmountMicroUsdc)}</td>
                    <td className="py-2 pr-2">{operation.actualCostMicroUsdc ? money(operation.actualCostMicroUsdc) : `${operation.costBasis}, not verified`}</td>
                    <td className="py-2 pr-2">{operation.state}</td>
                    <td className="py-2 pr-2">{operation.settlementStatus}</td>
                    <td className="py-2 font-mono">
                      {href ? <a className="underline" href={href}>{operation.signature}</a> : operation.signature ?? 'No chain transaction'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-card border border-border rounded-2xl p-4 space-y-3" data-testid="live-telemetry">
        <h2 className="font-semibold text-sm">Live telemetry event stream</h2>
        {telemetry.length === 0 && <p className="text-xs text-text-muted">No live events captured yet.</p>}
        <div className="space-y-1">
          {telemetry.map((event) => (
            <div key={event.id} className="text-xs font-mono flex items-center justify-between border-b border-border/50 py-1" data-testid="telemetry-event">
              <span className="text-text-muted">[{event.timestamp}]</span>
              <span className={event.type === 'APPROVED' ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>{event.type}</span>
              <span>{event.agent}</span>
              <span>{event.vendor}</span>
              <span>${event.amountUsdc.toFixed(4)} USDC</span>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-card border border-border rounded-2xl p-4 space-y-2">
        <h2 className="font-semibold text-sm">From the stored records</h2>
        {dashboard && Object.keys(dashboard.spendByVendor).length === 0 && <p className="text-xs text-text-muted">No accounted spend yet, so there is no trend to draw.</p>}
        {dashboard && Object.entries(dashboard.spendByVendor).map(([vendor, amount]) => (
          <p key={vendor} className="text-xs font-mono">{vendor}: {amount.formatted} USDC</p>
        ))}
        {dashboard && <p className="text-xs text-text-muted">Settlement states: {Object.entries(dashboard.settlement).map(([name, count]) => `${name} ${count}`).join(', ') || 'none'}.</p>}
      </section>
    </Shell>
  );
};

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-background text-text-primary p-6 space-y-4">{children}</main>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <p className="text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className="text-sm font-mono mt-1">{value}</p>
    </div>
  );
}
