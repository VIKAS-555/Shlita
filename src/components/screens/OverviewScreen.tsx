import React, { useState } from 'react';
import {
  TrendingUp,
  Bot,
  ShieldAlert,
  Wallet,
  ArrowRight,
  Play,
  CheckCircle2,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Agent, SpendingPolicy, Transaction } from '../../types/dashboard.js';
import { ScreenId } from '../layout/Sidebar.js';
import { SolanaArchitectureFlow } from '../visualizer/SolanaArchitectureFlow.js';

interface OverviewScreenProps {
  agents: Agent[];
  policies: SpendingPolicy[];
  transactions: Transaction[];
  onSelectScreen: (screen: ScreenId) => void;
  onOpenCreateAgent: () => void;
  onSelectTransaction: (tx: Transaction) => void;
  onRunSimulation: () => void;
  simulationStep: number;
  onOpenSimulator?: () => void;
}

export const OverviewScreen: React.FC<OverviewScreenProps> = ({
  agents,
  policies,
  transactions,
  onSelectScreen,
  onOpenCreateAgent,
  onSelectTransaction,
  onRunSimulation,
  simulationStep,
  onOpenSimulator,
}) => {
  const [timeRange, setTimeRange] = useState<'day' | 'week' | 'month'>('month');

  // Chart data
  const chartData = [
    { name: 'Jan', spend: 820, budget: 2000 },
    { name: 'Feb', spend: 1140, budget: 2000 },
    { name: 'Mar', spend: 980, budget: 2500 },
    { name: 'Apr', spend: 1650, budget: 3000 },
    { name: 'May', spend: 1420, budget: 3500 },
    { name: 'Jun', spend: 1847, budget: 4250 },
    { name: 'Jul', spend: 2100, budget: 4500 },
    { name: 'Aug', spend: 1950, budget: 4500 },
    { name: 'Sep', spend: 2300, budget: 5000 },
    { name: 'Oct', spend: 2450, budget: 5000 },
    { name: 'Nov', spend: 1847, budget: 5000 },
  ];

  const totalBudget = 5000;
  const currentSpent = 1847.32;
  const utilizationPercent = Math.round((currentSpent / totalBudget) * 100);

  return (
    <div className="space-y-6">
      {/* Top Banner / Welcome Strip */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card border border-border p-6 rounded-2xl shadow-sm">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary">Good morning, Jesse.</h2>
            <span className="text-xs bg-solana/10 text-solana border border-solana/25 font-mono px-2 py-0.5 rounded-full">
              SOLANA MAINNET
            </span>
          </div>
          <p className="text-xs sm:text-sm text-text-muted mt-1">
            Here's what's moving across your autonomous agents and USDC allowance vaults today.
          </p>
        </div>

        {/* Hero Interactive Simulation CTA */}
        <div className="flex items-center space-x-2.5">
          <button
            onClick={onOpenSimulator || onRunSimulation}
            className="flex items-center space-x-2 bg-gradient-to-r from-accent-violet via-solana-purple to-solana hover:opacity-95 text-white font-semibold text-xs px-4 py-2.5 rounded-xl shadow-sm transition group cursor-pointer"
            title="Open Interactive Attack Simulator & Circuit Breaker Playground"
          >
            <Play size={13} className="fill-white group-hover:scale-110 transition" />
            <span>Attack Simulator & Playground</span>
          </button>
          <button
            onClick={onOpenCreateAgent}
            className="text-xs bg-card-elevated hover:bg-border text-text-primary border border-border px-3.5 py-2.5 rounded-xl transition shadow-sm cursor-pointer"
          >
            + Add Agent
          </button>
        </div>
      </div>

      {/* Financial Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1 */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm hover:border-border-hover transition">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Wallet Balance</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
              <Wallet size={16} />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-text-primary mt-2 font-mono tracking-tight">$4,250.00</div>
          <div className="flex items-center text-xs text-text-muted mt-2">
            <span className="text-emerald-500 font-medium">Available to spend</span>
            <span className="mx-1.5">•</span>
            <span>USDC Mint</span>
          </div>
          <div className="w-full bg-border-subtle h-1.5 rounded-full mt-3 overflow-hidden">
            <div className="bg-emerald-500 h-full rounded-full" style={{ width: '85%' }}></div>
          </div>
        </div>

        {/* Card 2 */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm hover:border-border-hover transition">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Spent This Week</span>
            <div className="p-2 rounded-lg bg-accent-violet/10 text-accent-violet">
              <TrendingUp size={16} />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-text-primary mt-2 font-mono tracking-tight">$1,847.32</div>
          <div className="flex items-center text-xs mt-2">
            <span className="text-emerald-500 font-medium">↑ 23% vs last week</span>
            <span className="text-text-faint mx-1.5">•</span>
            <span className="text-text-muted">43% of budget</span>
          </div>
          <div className="w-full bg-border-subtle h-1.5 rounded-full mt-3 overflow-hidden">
            <div className="bg-accent-violet h-full rounded-full" style={{ width: '43%' }}></div>
          </div>
        </div>

        {/* Card 3 */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm hover:border-border-hover transition">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Active AI Agents</span>
            <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-500">
              <Bot size={16} />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-text-primary mt-2 font-mono tracking-tight">6</div>
          <div className="flex items-center text-xs text-text-muted mt-2">
            <span className="text-cyan-500 font-medium">5 active</span>
            <span className="mx-1.5">•</span>
            <span className="text-amber-500 font-medium">1 circuit tripped</span>
          </div>
          <div className="w-full bg-border-subtle h-1.5 rounded-full mt-3 overflow-hidden">
            <div className="bg-cyan-500 h-full rounded-full" style={{ width: '83%' }}></div>
          </div>
        </div>

        {/* Card 4 */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm hover:border-border-hover transition">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Blocked Violations</span>
            <div className="p-2 rounded-lg bg-red-500/10 text-red-500">
              <ShieldAlert size={16} />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-red-500 mt-2 font-mono tracking-tight">2 Flagged</div>
          <div className="flex items-center text-xs text-text-muted mt-2">
            <span className="text-text-primary font-medium">Saved $135.00</span>
            <span className="mx-1.5">•</span>
            <span>Zero drain</span>
          </div>
          <div className="w-full bg-border-subtle h-1.5 rounded-full mt-3 overflow-hidden">
            <div className="bg-red-500 h-full rounded-full" style={{ width: '100%' }}></div>
          </div>
        </div>
      </div>

      {/* Live Interactive Solana Architecture & Cryptographic Flowchart */}
      <SolanaArchitectureFlow
        initialState={
          simulationStep === 1
            ? 'AUTHORIZED'
            : simulationStep === 2
            ? 'BLOCKED'
            : 'IDLE'
        }
      />

      {/* Main Grid: Chart + Utilization (2 Cols) vs Right Rail (1 Col) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Spending Trend Chart */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-border/80 gap-3">
              <div>
                <h3 className="font-bold text-text-primary text-base">Spending & Allowance Trends</h3>
                <p className="text-xs text-text-muted mt-0.5">Aggregate AI agent expenditures vs authorized cap</p>
              </div>
              <div className="flex items-center bg-card-elevated border border-border p-1 rounded-xl text-xs font-mono">
                {(['day', 'week', 'month'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setTimeRange(mode)}
                    className={`px-3 py-1 rounded-lg capitalize transition ${
                      timeRange === mode
                        ? 'bg-accent-violet text-white font-semibold shadow-sm'
                        : 'text-text-muted hover:text-text-primary'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Area Chart Container */}
            <div className="h-64 mt-4 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#7C3AED" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#7C3AED" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="budgetGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="name" stroke="#94A3B8" fontSize={11} tickLine={false} />
                  <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--bg-card-elevated)',
                      borderColor: 'var(--border)',
                      color: 'var(--text-primary)',
                      borderRadius: '12px',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="spend"
                    stroke="#7C3AED"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#spendGradient)"
                  />
                  <Area
                    type="monotone"
                    dataKey="budget"
                    stroke="#10B981"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    fillOpacity={1}
                    fill="url(#budgetGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Legend / Metrics Footer */}
            <div className="flex items-center justify-between pt-4 border-t border-border/80 text-xs text-text-muted font-mono">
              <div className="flex items-center space-x-4">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-accent-violet"></span>
                  <span>Agent Actual Spend</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                  <span>Authorized Budget Cap</span>
                </span>
              </div>
              <span>Updated in real-time</span>
            </div>
          </div>

          {/* Recent Activity Table */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between pb-4 border-b border-border/80">
              <div>
                <h3 className="font-bold text-text-primary text-base">Recent Agent Activity</h3>
                <p className="text-xs text-text-muted mt-0.5">Live execution telemetry through Shlita perimeter</p>
              </div>
              <button
                onClick={() => onSelectScreen('transactions')}
                className="text-xs text-accent-violet hover:underline flex items-center gap-1 font-mono font-medium"
              >
                <span>View all activity</span>
                <ArrowRight size={12} />
              </button>
            </div>

            <div className="overflow-x-auto mt-2">
              <table className="w-full text-left text-xs">
                <thead className="text-text-muted border-b border-border/60 font-mono text-[11px]">
                  <tr>
                    <th className="py-3 px-2">AGENT → PROVIDER</th>
                    <th className="py-3 px-2">AMOUNT</th>
                    <th className="py-3 px-2">STATUS</th>
                    <th className="py-3 px-2 text-right">TIME</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40 font-mono">
                  {transactions.slice(0, 5).map((tx) => (
                    <tr
                      key={tx.id}
                      onClick={() => onSelectTransaction(tx)}
                      className="hover:bg-card-elevated/60 transition cursor-pointer group"
                    >
                      <td className="py-3 px-2">
                        <div className="flex items-center space-x-2">
                          <span className="font-semibold text-text-primary group-hover:text-accent-violet transition">
                            {tx.agentName}
                          </span>
                          <span className="text-text-faint">→</span>
                          <span className="text-text-secondary">{tx.providerName}</span>
                        </div>
                      </td>
                      <td className="py-3 px-2 font-bold text-text-primary">
                        ${tx.amountUsdc.toFixed(tx.amountUsdc < 1 ? 3 : 2)} USDC
                      </td>
                      <td className="py-3 px-2">
                        {tx.status === 'CONFIRMED' && (
                          <span className="inline-flex items-center gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 px-2 py-0.5 rounded-full text-[10px]">
                            <CheckCircle2 size={10} /> Auto-approved
                          </span>
                        )}
                        {tx.status === 'PENDING' && (
                          <span className="inline-flex items-center gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25 px-2 py-0.5 rounded-full text-[10px]">
                            <Clock size={10} /> Pending
                          </span>
                        )}
                        {tx.status === 'BLOCKED_BY_POLICY' && (
                          <span className="inline-flex items-center gap-1 bg-red-500/10 text-red-500 border border-red-500/25 px-2 py-0.5 rounded-full text-[10px]">
                            <AlertTriangle size={10} /> Blocked
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-2 text-right text-text-faint text-[11px]">
                        {tx.timestamp}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Rail (1 Col): Active Agents + Spend Rules */}
        <div className="space-y-6">
          {/* Active Agents Card */}
          <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-border/80">
              <h4 className="font-bold text-text-primary text-sm">Active Agents</h4>
              <button
                onClick={() => onSelectScreen('agents')}
                className="text-xs text-accent-violet hover:underline font-mono"
              >
                Manage →
              </button>
            </div>
            <div className="space-y-2.5 mt-3">
              {agents.slice(0, 4).map((agent) => (
                <div
                  key={agent.id}
                  onClick={() => onSelectScreen('agents')}
                  className="flex items-center justify-between p-2.5 rounded-xl hover:bg-card-elevated cursor-pointer border border-transparent hover:border-border transition"
                >
                  <div className="flex items-center space-x-2.5 truncate">
                    <span className="text-base">{agent.avatar}</span>
                    <div className="truncate">
                      <div className="text-xs font-semibold text-text-primary truncate">{agent.name}</div>
                      <div className="text-[10px] text-text-muted font-mono">{agent.environment}</div>
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <div className="text-xs font-bold text-text-primary">${agent.dailyBudgetUsdc}/day</div>
                    <div className="text-[10px] text-emerald-600 dark:text-emerald-400">
                      ${agent.spentThisMonthUsdc.toFixed(2)} spent
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Spend Rules Card */}
          <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-border/80">
              <h4 className="font-bold text-text-primary text-sm">Spend Rules</h4>
              <button
                onClick={() => onSelectScreen('policies')}
                className="text-xs text-accent-violet hover:underline font-mono"
              >
                Edit rules →
              </button>
            </div>
            <div className="space-y-2 mt-3 text-xs font-mono">
              <div className="flex items-center justify-between p-2.5 bg-card-elevated rounded-xl border border-border/60">
                <span className="text-text-muted">Auto-approve under</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">$100.00 USDC</span>
              </div>
              <div className="flex items-center justify-between p-2.5 bg-card-elevated rounded-xl border border-border/60">
                <span className="text-text-muted">Human review over</span>
                <span className="font-bold text-amber-600 dark:text-amber-400">$500.00 USDC</span>
              </div>
              <div className="flex items-center justify-between p-2.5 bg-card-elevated rounded-xl border border-border/60">
                <span className="text-text-muted">Daily wallet limit</span>
                <span className="font-bold text-text-primary">$2,000.00 USDC</span>
              </div>
              <div className="flex items-center justify-between p-2.5 bg-card-elevated rounded-xl border border-border/60">
                <span className="text-text-muted">Circuit Breaker</span>
                <span className="font-bold text-solana">8 calls/min cap</span>
              </div>
            </div>
          </div>

          {/* Budget Utilization Ring */}
          <div className="bg-card border border-border rounded-2xl p-5 shadow-sm text-center space-y-3">
            <h4 className="font-bold text-text-primary text-sm text-left">Monthly Budget Utilization</h4>
            <div className="relative inline-flex items-center justify-center">
              <svg className="w-32 h-32 transform -rotate-90">
                <circle
                  cx="64"
                  cy="64"
                  r="52"
                  stroke="var(--border)"
                  strokeWidth="8"
                  fill="transparent"
                />
                <circle
                  cx="64"
                  cy="64"
                  r="52"
                  stroke="#7C3AED"
                  strokeWidth="8"
                  strokeDasharray={326}
                  strokeDashoffset={326 - (326 * utilizationPercent) / 100}
                  strokeLinecap="round"
                  fill="transparent"
                  className="transition-all duration-700"
                />
              </svg>
              <div className="absolute flex flex-col items-center">
                <span className="text-2xl font-extrabold text-text-primary font-mono">{utilizationPercent}%</span>
                <span className="text-[10px] text-text-muted uppercase tracking-wider">Used</span>
              </div>
            </div>
            <div className="text-xs text-text-muted font-mono">
              ${currentSpent.toFixed(2)} spent of ${totalBudget.toFixed(2)} allocated
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
