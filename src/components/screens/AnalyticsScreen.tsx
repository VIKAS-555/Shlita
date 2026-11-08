import React, { useState } from 'react';
import {
  BarChart3,
  Download,
  Calendar,
  TrendingUp,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { Agent, Provider, Transaction } from '../../types/dashboard.js';

interface AnalyticsScreenProps {
  agents: Agent[];
  providers: Provider[];
  transactions: Transaction[];
}

export const AnalyticsScreen: React.FC<AnalyticsScreenProps> = ({
  agents,
  providers,
  transactions,
}) => {
  const [filterPeriod, setFilterPeriod] = useState<'7d' | '30d' | '90d'>('30d');

  // Comparative spending by Agent
  const agentSpendData = agents.map((a) => ({
    name: a.name.length > 15 ? a.name.substring(0, 13) + '..' : a.name,
    spend: a.spentThisMonthUsdc,
    budget: a.monthlyBudgetUsdc,
  }));

  // Provider share data
  const providerData = providers.map((p) => ({
    name: p.name,
    value: p.totalSpentUsdc,
  }));

  const COLORS = ['#8B72FF', '#14F195', '#06B6D4', '#F59E0B', '#EC4899', '#3B82F6', '#84CC16'];

  // Download CSV implementation
  const handleExportCsv = () => {
    const headers = ['Transaction ID', 'Signature', 'Agent', 'Provider', 'Amount USDC', 'Token', 'Status', 'Timestamp', 'Network Fee SOL'];
    const rows = transactions.map((t) => [
      t.id,
      t.signature,
      `"${t.agentName}"`,
      `"${t.providerName}"`,
      t.amountUsdc,
      t.token,
      t.status,
      `"${t.timestamp}"`,
      t.networkFeeSol,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `autostream-analytics-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header with Export CTA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Financial & Agent Analytics</h2>
          <p className="text-xs text-slate-400 mt-1">
            Real-time multi-dimensional reporting across AI agent allowances, provider shares, and policy blocks.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1 bg-card border border-border p-1 rounded-xl text-xs font-mono">
            {(['7d', '30d', '90d'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setFilterPeriod(p)}
                className={`px-3 py-1 rounded-lg transition ${
                  filterPeriod === p
                    ? 'bg-accent-violet text-white font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <button
            onClick={handleExportCsv}
            className="flex items-center space-x-2 bg-card hover:bg-slate-800 border border-border text-slate-200 text-xs px-3.5 py-2 rounded-xl transition cursor-pointer"
          >
            <Download size={14} />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Grid: Agent Comparative Bar Chart (Left) & Provider Share Donut (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Agent Comparison Bar Chart */}
        <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-6 glow-card">
          <div className="flex items-center justify-between pb-4 border-b border-border">
            <div>
              <h3 className="font-bold text-white text-base">Spend vs. Allocated Budget by Agent</h3>
              <p className="text-xs text-slate-400 mt-0.5">Compares monthly limit consumption across agents</p>
            </div>
            <span className="text-xs text-solana font-mono">Monthly Cycle</span>
          </div>

          <div className="h-72 mt-4 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agentSpendData} margin={{ top: 20, right: 10, left: -20, bottom: 25 }}>
                <XAxis dataKey="name" stroke="#475569" fontSize={10} angle={-15} textAnchor="end" />
                <YAxis stroke="#475569" fontSize={11} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#171A26',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                  }}
                />
                <Bar dataKey="spend" fill="#8B72FF" radius={[6, 6, 0, 0]} name="Actual Spent (USDC)" />
                <Bar dataKey="budget" fill="#232838" radius={[6, 6, 0, 0]} name="Monthly Ceiling (USDC)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Provider Distribution Pie */}
        <div className="bg-card border border-border rounded-2xl p-6 glow-card flex flex-col justify-between">
          <div className="pb-4 border-b border-border">
            <h3 className="font-bold text-white text-base">Provider Expenditure Share</h3>
            <p className="text-xs text-slate-400 mt-0.5">Total USDC transferred by merchant</p>
          </div>

          <div className="h-56 my-2 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={providerData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {providerData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#171A26',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderRadius: '12px',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-1.5 pt-2 border-t border-border font-mono text-xs">
            {providers.slice(0, 4).map((p, idx) => (
              <div key={p.id} className="flex items-center justify-between">
                <div className="flex items-center space-x-2 truncate">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }}></span>
                  <span className="text-slate-300 truncate">{p.name}</span>
                </div>
                <span className="text-white font-bold">${p.totalSpentUsdc.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
