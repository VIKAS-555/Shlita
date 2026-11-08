import React, { useState } from 'react';
import {
  Bot,
  Plus,
  Search,
  SlidersHorizontal,
  CheckCircle2,
  PauseCircle,
  AlertOctagon,
  Key,
  ShieldCheck,
  ExternalLink,
  X,
  Play,
  RotateCcw,
} from 'lucide-react';
import { Agent } from '../../types/dashboard.js';

interface AgentsScreenProps {
  agents: Agent[];
  onOpenCreateWizard: () => void;
  onToggleAgentPause: (agentId: string) => void;
  onResetCircuitBreaker: (agentId: string) => void;
}

export const AgentsScreen: React.FC<AgentsScreenProps> = ({
  agents,
  onOpenCreateWizard,
  onToggleAgentPause,
  onResetCircuitBreaker,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  const filteredAgents = agents.filter((agent) => {
    const matchesSearch =
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      filterStatus === 'ALL' || agent.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">AI Agents</h2>
          <p className="text-xs text-slate-400 mt-1">
            Manage your autonomous software actors, spending limits, and assigned Solana allowance PDAs.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={onOpenCreateWizard}
            className="flex items-center space-x-2 bg-gradient-to-r from-accent-violet to-solana-purple hover:opacity-95 text-white font-semibold text-xs px-4 py-2.5 rounded-xl shadow-lg shadow-accent-violet/20 transition cursor-pointer"
          >
            <Plus size={16} />
            <span>Create Agent</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar (AgentxSuite style) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search agents by name or capability..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-card border border-border focus:border-accent-violet rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 outline-none transition"
          />
        </div>
        <div className="flex items-center space-x-1.5 bg-card border border-border p-1 rounded-xl text-xs font-mono">
          {(['ALL', 'ACTIVE', 'PAUSED', 'CIRCUIT_TRIPPED'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`px-3 py-1 rounded-lg transition ${
                filterStatus === status
                  ? 'bg-accent-violet text-white font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {status === 'ALL' ? 'All' : status.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Agents Table (AgentxSuite inspired) */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden glow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 border-b border-border font-mono text-[11px]">
              <tr>
                <th className="py-3.5 px-4">AGENT NAME</th>
                <th className="py-3.5 px-4">ENVIRONMENT</th>
                <th className="py-3.5 px-4">MODE</th>
                <th className="py-3.5 px-4">DAILY BUDGET</th>
                <th className="py-3.5 px-4">SPENT (CYCLE)</th>
                <th className="py-3.5 px-4">STATUS</th>
                <th className="py-3.5 px-4 text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 font-mono">
              {filteredAgents.map((agent) => (
                <tr
                  key={agent.id}
                  onClick={() => setSelectedAgent(agent)}
                  className="hover:bg-slate-850/60 transition cursor-pointer group"
                >
                  <td className="py-3.5 px-4">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-xl bg-slate-800 border border-border flex items-center justify-center text-sm shadow-sm">
                        {agent.avatar}
                      </div>
                      <div>
                        <div className="font-bold text-white group-hover:text-accent-violet transition">
                          {agent.name}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate max-w-xs font-sans">
                          {agent.description}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="text-slate-300 bg-slate-900 px-2 py-0.5 rounded border border-border/80">
                      {agent.environment}
                    </span>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="bg-accent-violet/10 text-accent-violet border border-accent-violet/30 px-2 py-0.5 rounded text-[10px] font-semibold">
                      {agent.mode}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 font-bold text-slate-200">
                    ${agent.dailyBudgetUsdc.toFixed(2)}
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="space-y-1">
                      <div className="text-emerald-400 font-bold">${agent.spentThisMonthUsdc.toFixed(2)}</div>
                      <div className="w-20 bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-emerald-400 h-full rounded-full"
                          style={{
                            width: `${Math.min(
                              100,
                              Math.round((agent.spentThisMonthUsdc / agent.monthlyBudgetUsdc) * 100)
                            )}%`,
                          }}
                        ></div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4">
                    {agent.status === 'ACTIVE' && (
                      <span className="inline-flex items-center gap-1.5 text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full text-[10px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Active
                      </span>
                    )}
                    {agent.status === 'PAUSED' && (
                      <span className="inline-flex items-center gap-1.5 text-slate-400 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-full text-[10px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span> Paused
                      </span>
                    )}
                    {agent.status === 'CIRCUIT_TRIPPED' && (
                      <span className="inline-flex items-center gap-1.5 text-red-400 bg-red-500/10 border border-red-500/30 px-2 py-0.5 rounded-full text-[10px] font-bold">
                        <AlertOctagon size={12} /> Circuit Tripped
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <div className="inline-flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
                      {agent.status === 'CIRCUIT_TRIPPED' ? (
                        <button
                          onClick={() => onResetCircuitBreaker(agent.id)}
                          className="text-xs bg-emerald-950/70 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 px-2.5 py-1 rounded-lg flex items-center gap-1 transition"
                        >
                          <RotateCcw size={12} /> Reset Circuit
                        </button>
                      ) : (
                        <button
                          onClick={() => onToggleAgentPause(agent.id)}
                          className={`text-xs px-2.5 py-1 rounded-lg border transition ${
                            agent.status === 'ACTIVE'
                              ? 'bg-slate-800 hover:bg-slate-750 text-slate-300 border-border'
                              : 'bg-emerald-950/70 hover:bg-emerald-900 text-emerald-300 border-emerald-800'
                          }`}
                        >
                          {agent.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-over Agent Detail Drawer */}
      {selectedAgent && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-lg bg-card border-l border-border h-full p-6 overflow-y-auto space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <div className="flex items-center space-x-3">
                <span className="text-2xl">{selectedAgent.avatar}</span>
                <div>
                  <h3 className="font-bold text-white text-base">{selectedAgent.name}</h3>
                  <span className="text-xs text-slate-400 font-mono">{selectedAgent.walletAddress}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedAgent(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Circuit Warning if Tripped */}
            {selectedAgent.status === 'CIRCUIT_TRIPPED' && (
              <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-red-400 font-bold text-xs">
                  <AlertOctagon size={16} />
                  <span>CIRCUIT BREAKER ACTIVATED</span>
                </div>
                <p className="text-xs text-slate-300">{selectedAgent.circuitTrippedReason}</p>
                <button
                  onClick={() => {
                    onResetCircuitBreaker(selectedAgent.id);
                    setSelectedAgent({ ...selectedAgent, status: 'ACTIVE', circuitTrippedReason: undefined });
                  }}
                  className="mt-2 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2 rounded-lg transition"
                >
                  Reset Circuit Breaker & Unfreeze Agent
                </button>
              </div>
            )}

            {/* Financial Parameters */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Spending Parameters</h4>
              <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                <div className="p-3 bg-slate-900 rounded-xl border border-border">
                  <span className="text-slate-400 block text-[10px]">DAILY BUDGET</span>
                  <span className="text-base font-bold text-white mt-1 block">
                    ${selectedAgent.dailyBudgetUsdc.toFixed(2)} USDC
                  </span>
                </div>
                <div className="p-3 bg-slate-900 rounded-xl border border-border">
                  <span className="text-slate-400 block text-[10px]">MAX PER CALL</span>
                  <span className="text-base font-bold text-white mt-1 block">
                    ${selectedAgent.maxPerCallUsdc.toFixed(2)} USDC
                  </span>
                </div>
                <div className="p-3 bg-slate-900 rounded-xl border border-border">
                  <span className="text-slate-400 block text-[10px]">SPENT THIS CYCLE</span>
                  <span className="text-base font-bold text-emerald-400 mt-1 block">
                    ${selectedAgent.spentThisMonthUsdc.toFixed(2)} USDC
                  </span>
                </div>
                <div className="p-3 bg-slate-900 rounded-xl border border-border">
                  <span className="text-slate-400 block text-[10px]">MONTHLY CEILING</span>
                  <span className="text-base font-bold text-white mt-1 block">
                    ${selectedAgent.monthlyBudgetUsdc.toFixed(2)} USDC
                  </span>
                </div>
              </div>
            </div>

            {/* Whitelisted Vendors */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Whitelisted Providers</h4>
              <div className="flex flex-wrap gap-2">
                {selectedAgent.allowedVendors.map((vendor) => (
                  <span
                    key={vendor}
                    className="bg-accent-violet/10 text-accent-violet border border-accent-violet/30 px-3 py-1 rounded-lg text-xs font-mono"
                  >
                    {vendor}
                  </span>
                ))}
              </div>
            </div>

            {/* Solana Onchain Authority Info */}
            <div className="bg-slate-950 p-4 rounded-xl border border-border/80 space-y-2 text-xs font-mono">
              <div className="flex items-center gap-1.5 text-solana font-bold">
                <ShieldCheck size={14} />
                <span>Solana Subscriptions Authority PDA</span>
              </div>
              <p className="text-slate-400 text-[11px] font-sans">
                Funds remain in the organization treasury. This agent interacts via a constrained PDA allowance vault
                derived from seed <code className="text-slate-200">["subscription", agent, mint]</code>.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
