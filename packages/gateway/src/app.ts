import { Hono } from 'hono';
import { PolicyEngine } from '../../core/src/index.js';

export function createGatewayApp(engine: PolicyEngine) {
  const app = new Hono();

  // Middleware for CORS and logging
  app.use('*', async (c, next) => {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (c.req.method === 'OPTIONS') {
      return c.text('', 204);
    }
    await next();
  });

  // Proxy endpoint for AI Agent outbound requests
  app.post('/v1/proxy', async (c) => {
    const body = await c.req.json();
    const {
      agentId,
      vendor,
      estimatedCostMicroUsdc = '10000',
      method = 'POST',
      path = '/',
      payload,
    } = body;

    const costBigInt = BigInt(estimatedCostMicroUsdc);
    const now = Date.now();

    const decision = engine.evaluate({
      agentId,
      vendor,
      estimatedCostMicroUsdc: costBigInt,
      timestamp: now,
    });

    if (!decision.allowed) {
      c.header('x-shlita-decision', 'BLOCKED');
      c.header('x-shlita-violation-reason', decision.reason);
      return c.json(
        {
          allowed: false,
          error: 'POLICY_VIOLATION',
          reason: decision.reason,
          message: decision.message,
          timestamp: now,
        },
        403
      );
    }

    // Mock vendor dispatch with realistic simulated data
    let responseData: any = {
      vendor,
      path,
      status: 200,
      timestamp: new Date().toISOString(),
    };

    if (vendor === 'api.helius.xyz') {
      responseData.data = {
        network: 'solana-mainnet-beta',
        slot: 318492048,
        result: {
          account: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          balanceUsdc: 450.25,
          activeSubscriptions: 3,
        },
      };
    } else if (vendor === 'api.tavily.com') {
      responseData.data = {
        query: 'Solana hackathon winners 2026',
        results: [
          { title: 'Top Solana Hackathon Patterns', score: 0.98 },
          { title: 'Solana Foundation Subscriptions Announcement', score: 0.94 },
        ],
      };
    } else {
      responseData.data = { message: 'Upstream vendor request fulfilled successfully' };
    }

    // Record successful execution
    engine.recordExecution(
      {
        agentId,
        vendor,
        estimatedCostMicroUsdc: costBigInt,
        timestamp: now,
      },
      { success: true, actualCostMicroUsdc: costBigInt }
    );

    const state = engine.getAgentState(agentId);

    c.header('x-shlita-decision', 'ALLOWED');
    c.header('x-shlita-spend-micro-usdc', state.currentPeriodSpendMicroUsdc.toString());
    c.header('x-shlita-agent-status', state.status);

    return c.json({
      success: true,
      vendor,
      settlement: {
        costMicroUsdc: costBigInt.toString(),
        currency: 'USDC',
        status: 'SETTLED',
      },
      upstream: responseData,
    });
  });

  // Get all registered agents, policies, and live financial metrics
  app.get('/v1/agents', (c) => {
    const policies = engine.getAllPolicies();
    const states = engine.getAllStates();

    const agents = policies.map((policy) => {
      const state = states.find((s) => s.agentId === policy.agentId);
      const budgetExhausted =
        (state?.currentPeriodSpendMicroUsdc ?? 0n) >= policy.periodBudgetMicroUsdc;

      return {
        agentId: policy.agentId,
        status: state?.status ?? 'ACTIVE',
        freezeReason: state?.freezeReason,
        spending: {
          currentPeriodSpendMicroUsdc: (state?.currentPeriodSpendMicroUsdc ?? 0n).toString(),
          periodBudgetMicroUsdc: policy.periodBudgetMicroUsdc.toString(),
          maxPerCallMicroUsdc: policy.maxPerCallMicroUsdc.toString(),
          totalLifetimeSpendMicroUsdc: (state?.totalLifetimeSpendMicroUsdc ?? 0n).toString(),
          spendPercentage: Number(
            ((state?.currentPeriodSpendMicroUsdc ?? 0n) * 100n) / policy.periodBudgetMicroUsdc
          ),
          budgetExhausted,
        },
        policy: {
          allowedVendors: policy.allowedVendors,
          periodSeconds: policy.periodSeconds,
          circuitBreaker: policy.circuitBreaker,
        },
        consecutiveErrors: state?.consecutiveErrors ?? 0,
      };
    });

    return c.json({ agents });
  });

  // Emergency Freeze
  app.post('/v1/agents/:id/freeze', async (c) => {
    const agentId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    engine.freezeAgent(agentId, body.reason || 'Manual operator freeze');
    return c.json({ success: true, agentId, status: 'AGENT_FROZEN' });
  });

  // Unfreeze
  app.post('/v1/agents/:id/unfreeze', (c) => {
    const agentId = c.req.param('id');
    engine.unfreezeAgent(agentId);
    return c.json({ success: true, agentId, status: 'ACTIVE' });
  });

  // Audit Logs
  app.get('/v1/audit', (c) => {
    const logs = engine.getAuditLogs(50);
    return c.json({ logs });
  });

  // Visual Control Plane Dashboard (HTML)
  app.get('/', (c) => {
    return c.html(renderDashboardHtml());
  });

  return app;
}

function renderDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shlita (שְׁלִיטָה) — AI Agent Financial Control Plane</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            solana: { DEFAULT: '#14F195', purple: '#9945FF' },
            slate: { 850: '#131926', 900: '#0F172A', 950: '#080C14' }
          }
        }
      }
    }
  </script>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen font-sans antialiased">
  <!-- Navigation Header -->
  <header class="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-50">
    <div class="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <div class="h-9 w-9 rounded-xl bg-gradient-to-tr from-solana to-solana-purple flex items-center justify-center font-bold text-black text-xl shadow-lg shadow-solana/20">
          ש
        </div>
        <div>
          <h1 class="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            SHLITA <span class="text-xs bg-solana/10 text-solana px-2 py-0.5 rounded-full border border-solana/30 font-mono">v0.1.0-mainnet</span>
          </h1>
          <p class="text-xs text-slate-400">Autonomous AI Agent Financial Control Plane on Solana</p>
        </div>
      </div>
      <div class="flex items-center space-x-4">
        <div class="flex items-center gap-2 text-xs font-mono bg-slate-850 px-3 py-1.5 rounded-lg border border-slate-700">
          <span class="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>GATEWAY ONLINE</span>
        </div>
        <button onclick="refreshData()" class="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 transition">
          ↻ Refresh
        </button>
      </div>
    </div>
  </header>

  <!-- Main Content Container -->
  <main class="max-w-7xl mx-auto px-6 py-8 space-y-8">
    <!-- Hero Metrics Strip -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div class="text-xs uppercase tracking-wider text-slate-400 font-semibold">Active Agents</div>
        <div id="stat-active-agents" class="text-2xl font-bold text-white mt-2">--</div>
        <div class="text-xs text-emerald-400 mt-1">Autonomous policy enforcement</div>
      </div>
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div class="text-xs uppercase tracking-wider text-slate-400 font-semibold">Total Settled (24h)</div>
        <div id="stat-total-settled" class="text-2xl font-bold text-solana mt-2">--</div>
        <div class="text-xs text-slate-400 mt-1">Settled via Solana USDC</div>
      </div>
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div class="text-xs uppercase tracking-wider text-slate-400 font-semibold">Circuit Status</div>
        <div id="stat-circuit-status" class="text-2xl font-bold text-emerald-400 mt-2">NORMAL</div>
        <div class="text-xs text-slate-400 mt-1">0 anomaly trips</div>
      </div>
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div class="text-xs uppercase tracking-wider text-slate-400 font-semibold">Blocked Policy Violations</div>
        <div id="stat-violations" class="text-2xl font-bold text-red-400 mt-2">--</div>
        <div class="text-xs text-slate-400 mt-1">Intercepted before dispatch</div>
      </div>
    </div>

    <!-- Active Agents Grid -->
    <div>
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold text-white flex items-center gap-2">
          <span>Registered Autonomous Agents</span>
        </h2>
      </div>
      <div id="agents-container" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Rendered via JS -->
      </div>
    </div>

    <!-- Live Audit Stream -->
    <div class="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
      <div class="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="inline-block w-2 h-2 rounded-full bg-solana animate-ping"></span>
          <h3 class="font-bold text-white text-sm">Live Policy Evaluation & Audit Ledger</h3>
        </div>
        <span class="text-xs text-slate-400 font-mono">Last 50 Events</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs font-mono">
          <thead class="bg-slate-950/60 text-slate-400 border-b border-slate-800">
            <tr>
              <th class="py-3 px-4">TIMESTAMP</th>
              <th class="py-3 px-4">AGENT</th>
              <th class="py-3 px-4">TARGET VENDOR</th>
              <th class="py-3 px-4">EST. COST</th>
              <th class="py-3 px-4">DECISION</th>
              <th class="py-3 px-4">DETAILS</th>
            </tr>
          </thead>
          <tbody id="audit-tbody" class="divide-y divide-slate-800/60">
            <!-- Rendered via JS -->
          </tbody>
        </table>
      </div>
    </div>
  </main>

  <script>
    async function refreshData() {
      try {
        const [agentsRes, auditRes] = await Promise.all([
          fetch('/v1/agents').then(r => r.json()),
          fetch('/v1/audit').then(r => r.json())
        ]);

        renderAgents(agentsRes.agents);
        renderAudit(auditRes.logs);
      } catch (err) {
        console.error('Failed to refresh data', err);
      }
    }

    function renderAgents(agents) {
      document.getElementById('stat-active-agents').innerText = agents.length;
      let totalMicroUsdc = 0n;
      let circuitTrips = 0;

      const container = document.getElementById('agents-container');
      container.innerHTML = agents.map(agent => {
        const spend = BigInt(agent.spending.currentPeriodSpendMicroUsdc);
        const budget = BigInt(agent.spending.periodBudgetMicroUsdc);
        totalMicroUsdc += spend;
        if (agent.status !== 'ACTIVE') circuitTrips++;

        const percent = Math.min(100, Math.round(Number(spend * 100n / budget)));
        const statusBadge = agent.status === 'ACTIVE'
          ? '<span class="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded text-xs">● ACTIVE</span>'
          : '<span class="bg-red-500/10 text-red-400 border border-red-500/30 px-2 py-0.5 rounded text-xs">● ' + agent.status + '</span>';

        return \`
          <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4 hover:border-slate-700 transition">
            <div class="flex items-center justify-between">
              <div>
                <span class="text-xs font-mono text-slate-500">AGENT ID</span>
                <h4 class="text-base font-bold text-white font-mono">\${agent.agentId}</h4>
              </div>
              <div>\${statusBadge}</div>
            </div>

            <!-- Spending Gauge -->
            <div class="space-y-1">
              <div class="flex justify-between text-xs text-slate-400 font-mono">
                <span>Period Budget Spend</span>
                <span>\${(Number(spend)/1e6).toFixed(4)} / \${(Number(budget)/1e6).toFixed(2)} USDC (\${percent}%)</span>
              </div>
              <div class="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                <div class="h-full bg-gradient-to-r from-solana to-solana-purple transition-all duration-500" style="width: \${percent}%"></div>
              </div>
            </div>

            <!-- Policy Constraints -->
            <div class="grid grid-cols-2 gap-3 text-xs bg-slate-950 p-3 rounded-lg border border-slate-800/80 font-mono">
              <div>
                <span class="text-slate-500">Max Per Call:</span>
                <span class="text-slate-200 ml-1">\${(Number(agent.spending.maxPerCallMicroUsdc)/1e6).toFixed(3)} USDC</span>
              </div>
              <div>
                <span class="text-slate-500">Max Calls/Min:</span>
                <span class="text-slate-200 ml-1">\${agent.policy.circuitBreaker.maxCallsPerMinute}</span>
              </div>
              <div class="col-span-2">
                <span class="text-slate-500">Whitelisted Vendors:</span>
                <span class="text-emerald-400 ml-1">\${agent.policy.allowedVendors.join(', ')}</span>
              </div>
            </div>

            <!-- Controls -->
            <div class="pt-2 flex gap-3">
              \${agent.status === 'ACTIVE' 
                ? \`<button onclick="freezeAgent('\${agent.agentId}')" class="flex-1 bg-red-950/60 hover:bg-red-900 text-red-300 border border-red-800/60 text-xs py-2 rounded-lg font-semibold transition">
                    🛑 Emergency Kill-Switch
                   </button>\`
                : \`<button onclick="unfreezeAgent('\${agent.agentId}')" class="flex-1 bg-emerald-950/60 hover:bg-emerald-900 text-emerald-300 border border-emerald-800/60 text-xs py-2 rounded-lg font-semibold transition">
                    ✔ Reset Circuit & Unfreeze
                   </button>\`
              }
            </div>
          </div>
        \`;
      }).join('');

      document.getElementById('stat-total-settled').innerText = '$' + (Number(totalMicroUsdc)/1e6).toFixed(4) + ' USDC';
      document.getElementById('stat-circuit-status').innerText = circuitTrips === 0 ? 'NORMAL' : circuitTrips + ' TRIPPED';
      document.getElementById('stat-circuit-status').className = 'text-2xl font-bold mt-2 ' + (circuitTrips === 0 ? 'text-emerald-400' : 'text-red-400');
    }

    function renderAudit(logs) {
      let blockedCount = 0;
      const tbody = document.getElementById('audit-tbody');
      tbody.innerHTML = logs.map(l => {
        if (l.decision === 'BLOCKED') blockedCount++;
        const decisionBadge = l.decision === 'ALLOWED'
          ? '<span class="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">ALLOWED</span>'
          : '<span class="text-red-400 bg-red-500/10 px-2 py-0.5 rounded">BLOCKED</span>';

        return \`
          <tr class="hover:bg-slate-900/60 transition">
            <td class="py-2.5 px-4 text-slate-500">\${new Date(l.timestamp).toLocaleTimeString()}</td>
            <td class="py-2.5 px-4 text-slate-300">\${l.agentId}</td>
            <td class="py-2.5 px-4 text-solana">\${l.vendor}</td>
            <td class="py-2.5 px-4 text-slate-400">\${(Number(l.estimatedCostMicroUsdc)/1e6).toFixed(3)} USDC</td>
            <td class="py-2.5 px-4">\${decisionBadge}</td>
            <td class="py-2.5 px-4 text-slate-400 text-[11px]">\${l.reason || 'Policy Checks Passed'}</td>
          </tr>
        \`;
      }).join('');

      document.getElementById('stat-violations').innerText = blockedCount;
    }

    async function freezeAgent(id) {
      await fetch('/v1/agents/' + id + '/freeze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Operator Emergency Kill-Switch' })
      });
      refreshData();
    }

    async function unfreezeAgent(id) {
      await fetch('/v1/agents/' + id + '/unfreeze', { method: 'POST' });
      refreshData();
    }

    // Auto-poll every 3 seconds for live dashboard updates
    refreshData();
    setInterval(refreshData, 3000);
  </script>
</body>
</html>`;
}
