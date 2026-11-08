import React, { useState } from 'react';
import {
  Bot,
  Plus,
  Search,
  CheckCircle2,
  AlertOctagon,
  ShieldCheck,
  ShieldAlert,
  X,
  RotateCcw,
  Sliders,
  SlidersHorizontal,
  Flame,
  Check,
} from 'lucide-react';
import { Agent } from '../../types/dashboard.js';

interface AgentsScreenProps {
  agents: Agent[];
  onOpenCreateWizard: () => void;
  onToggleAgentPause: (agentId: string) => void;
  onResetCircuitBreaker: (agentId: string) => void;
  onUpdateAgentBudget?: (agentId: string, dailyBudget: number, monthlyBudget: number) => void;
  onUpdateAgentVendors?: (agentId: string, vendors: string[]) => void;
  onMasterTogglePauseAll?: (freeze: boolean) => void;
}

export const AgentsScreen: React.FC<AgentsScreenProps> = ({
  agents,
  onOpenCreateWizard,
  onToggleAgentPause,
  onResetCircuitBreaker,
  onUpdateAgentBudget,
  onUpdateAgentVendors,
  onMasterTogglePauseAll,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [newVendorInput, setNewVendorInput] = useState('');

  const allPaused = agents.every((a) => a.status === 'PAUSED');
  const activeCount = agents.filter((a) => a.status === 'ACTIVE').length;
  const trippedCount = agents.filter((a) => a.status === 'CIRCUIT_TRIPPED').length;

  const filteredAgents = agents.filter((agent) => {
    const matchesSearch =
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      filterStatus === 'ALL' || agent.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const handleBudgetChange = (newDaily: number) => {
    if (!selectedAgent) return;
    const newMonthly = newDaily * 10;
    setSelectedAgent({
      ...selectedAgent,
      dailyBudgetUsdc: newDaily,
      monthlyBudgetUsdc: newMonthly,
    });
    if (onUpdateAgentBudget) {
      onUpdateAgentBudget(selectedAgent.id, newDaily, newMonthly);
    }
  };

  const handleRemoveVendor = (vendorToRemove: string) => {
    if (!selectedAgent) return;
    const updated = selectedAgent.allowedVendors.filter((v) => v !== vendorToRemove);
    setSelectedAgent({ ...selectedAgent, allowedVendors: updated });
    if (onUpdateAgentVendors) {
      onUpdateAgentVendors(selectedAgent.id, updated);
    }
  };

  const handleAddVendor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgent || !newVendorInput.trim()) return;
    const vendorClean = newVendorInput.trim().toLowerCase();
    if (!selectedAgent.allowedVendors.includes(vendorClean)) {
      const updated = [...selectedAgent.allowedVendors, vendorClean];
      setSelectedAgent({ ...selectedAgent, allowedVendors: updated });
      if (onUpdateAgentVendors) {
        onUpdateAgentVendors(selectedAgent.id, updated);
      }
    }
    setNewVendorInput('');
  };

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h2 className="text-xl font-bold text-text-primary tracking-tight">AI Agents</h2>
          <p className="text-xs text-text-muted mt-1">
            Manage your autonomous software actors, spending limits, and assigned Solana allowance PDAs.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={onOpenCreateWizard}
            className="flex items-center space-x-2 bg-gradient-to-r from-accent-violet to-solana-purple hover:opacity-95 text-white font-semibold text-xs px-4 py-2.5 rounded-xl shadow-sm transition cursor-pointer"
          >
            <Plus size={16} />
            <span>Create Agent</span>
          </button>
        </div>
      </div>

      {/* Master Emergency Kill-Switch Banner */}
      <div className="p-4 bg-card border border-border rounded-2xl shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div
            className={`p-2 rounded-xl ${
              allPaused
                ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
            }`}
          >
            {allPaused ? <ShieldAlert size={20} /> : <ShieldCheck size={20} />}
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-xs text-text-primary">Fleet Spending Status:</span>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold ${
                  allPaused
                    ? 'bg-amber-500/15 text-amber-400'
                    : 'bg-emerald-500/15 text-emerald-400'
                }`}
              >
                {allPaused ? 'ALL AGENTS PAUSED' : `${activeCount} OF ${agents.length} AGENTS ACTIVE`}
              </span>
              {trippedCount > 0 && (
                <span className="text-[10px] font-mono bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full font-bold animate-pulse">
                  {trippedCount} CIRCUIT TRIPPED
                </span>
              )}
            </div>
            <p className="text-[11px] text-text-muted mt-0.5">
              Live defense perimeter. Operators can halt all agent spending or reset anomalies simultaneously.
            </p>
          </div>
        </div>

        <button
          onClick={() => onMasterTogglePauseAll && onMasterTogglePauseAll(!allPaused)}
          className={`flex items-center gap-1.5 font-bold text-xs px-4 py-2 rounded-xl transition shadow-sm cursor-pointer whitespace-nowrap self-start sm:self-auto ${
            allPaused
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
              : 'bg-red-500/15 hover:bg-red-500/25 text-red-500 border border-red-500/30'
          }`}
        >
          {allPaused ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
          <span>{allPaused ? 'Resume All Agents' : 'Emergency Master Freeze'}</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search agents by name or capability..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-card border border-border focus:border-accent-violet rounded-xl pl-9 pr-4 py-2 text-xs text-text-primary placeholder-text-muted outline-none transition shadow-sm"
          />
        </div>
        <div className="flex items-center space-x-1.5 bg-card border border-border p-1 rounded-xl text-xs font-mono">
          {(['ALL', 'ACTIVE', 'PAUSED', 'CIRCUIT_TRIPPED'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`px-3 py-1 rounded-lg transition ${
                filterStatus === status
                  ? 'bg-accent-violet text-white font-semibold shadow-sm'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {status === 'ALL' ? 'All' : status.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Agents Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-card-elevated text-text-muted border-b border-border font-mono text-[11px]">
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
                  className="hover:bg-card-elevated/60 transition cursor-pointer group"
                >
                  <td className="py-3.5 px-4">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-xl bg-card-elevated border border-border flex items-center justify-center text-sm shadow-sm">
                        {agent.avatar}
                      </div>
                      <div>
                        <div className="font-semibold text-text-primary group-hover:text-accent-violet transition">
                          {agent.name}
                        </div>
                        <div className="text-[10px] text-text-muted truncate max-w-xs font-sans">
                          {agent.description}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="text-text-secondary bg-card-elevated px-2 py-0.5 rounded border border-border">
                      {agent.environment}
                    </span>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="bg-accent-violet/10 text-accent-violet border border-accent-violet/25 px-2 py-0.5 rounded text-[10px] font-semibold">
                      {agent.mode}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 font-bold text-text-primary">
                    ${agent.dailyBudgetUsdc.toFixed(2)}
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="space-y-1">
                      <div className="text-emerald-600 dark:text-emerald-400 font-bold">${agent.spentThisMonthUsdc.toFixed(2)}</div>
                      <div className="w-20 bg-border-subtle h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-emerald-500 h-full rounded-full"
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
                      <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded-full text-[10px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Active
                      </span>
                    )}
                    {agent.status === 'PAUSED' && (
                      <span className="inline-flex items-center gap-1.5 text-text-muted bg-card-elevated border border-border px-2 py-0.5 rounded-full text-[10px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-text-muted"></span> Paused
                      </span>
                    )}
                    {agent.status === 'CIRCUIT_TRIPPED' && (
                      <span className="inline-flex items-center gap-1.5 text-red-500 bg-red-500/10 border border-red-500/25 px-2 py-0.5 rounded-full text-[10px] font-bold">
                        <AlertOctagon size={12} /> Circuit Tripped
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <div className="inline-flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
                      {agent.status === 'CIRCUIT_TRIPPED' ? (
                        <button
                          onClick={() => onResetCircuitBreaker(agent.id)}
                          className="text-xs bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-lg flex items-center gap-1 transition cursor-pointer"
                        >
                          <RotateCcw size={12} /> Reset Circuit
                        </button>
                      ) : (
                        <button
                          onClick={() => onToggleAgentPause(agent.id)}
                          className={`text-xs px-2.5 py-1 rounded-lg border transition cursor-pointer ${
                            agent.status === 'ACTIVE'
                              ? 'bg-card-elevated hover:bg-border text-text-secondary border-border'
                              : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
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

      {/* Slide-over Agent Detail Drawer with LIVE SLIDERS & INLINE VENDOR CONTROLS */}
      {selectedAgent && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-lg bg-card border-l border-border h-full p-6 overflow-y-auto space-y-6 shadow-xl animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <div className="flex items-center space-x-3">
                <span className="text-2xl">{selectedAgent.avatar}</span>
                <div>
                  <h3 className="font-bold text-text-primary text-base">{selectedAgent.name}</h3>
                  <span className="text-xs text-text-muted font-mono">{selectedAgent.walletAddress}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedAgent(null)}
                className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-card-elevated transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Circuit Warning if Tripped */}
            {selectedAgent.status === 'CIRCUIT_TRIPPED' && (
              <div className="bg-red-500/10 border border-red-500/25 p-4 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-red-500 font-bold text-xs">
                  <AlertOctagon size={16} />
                  <span>CIRCUIT BREAKER ACTIVATED</span>
                </div>
                <p className="text-xs text-text-secondary">{selectedAgent.circuitTrippedReason || 'Rate anomaly detected: burst of repetitive requests exceeded policy threshold.'}</p>
                <button
                  onClick={() => {
                    onResetCircuitBreaker(selectedAgent.id);
                    setSelectedAgent({ ...selectedAgent, status: 'ACTIVE', circuitTrippedReason: undefined });
                  }}
                  className="mt-2 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2 rounded-lg transition cursor-pointer"
                >
                  Reset Circuit Breaker & Unfreeze Agent
                </button>
              </div>
            )}

            {/* LIVE BUDGET SLIDER */}
            <div className="bg-card-elevated p-4 rounded-xl border border-border space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="text-text-muted font-bold flex items-center gap-1.5">
                  <SlidersHorizontal size={14} className="text-accent-violet" />
                  LIVE DAILY BUDGET SLIDER
                </span>
                <span className="text-sm font-extrabold text-solana">
                  ${selectedAgent.dailyBudgetUsdc.toFixed(2)} USDC / day
                </span>
              </div>

              <input
                type="range"
                min="10"
                max="1000"
                step="10"
                value={selectedAgent.dailyBudgetUsdc}
                onChange={(e) => handleBudgetChange(Number(e.target.value))}
                className="w-full accent-accent-violet cursor-pointer"
              />

              <div className="flex justify-between text-[10px] text-text-muted">
                <span>$10 min</span>
                <span>Calculated Monthly: ${(selectedAgent.dailyBudgetUsdc * 10).toFixed(2)}</span>
                <span>$1,000 max</span>
              </div>
            </div>

            {/* Financial Parameters 4-Grid */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted font-mono">Spending Parameters</h4>
              <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                <div className="p-3 bg-card-elevated rounded-xl border border-border">
                  <span className="text-text-muted block text-[10px]">DAILY BUDGET</span>
                  <span className="text-base font-bold text-text-primary mt-1 block">
                    ${selectedAgent.dailyBudgetUsdc.toFixed(2)} USDC
                  </span>
                </div>
                <div className="p-3 bg-card-elevated rounded-xl border border-border">
                  <span className="text-text-muted block text-[10px]">MAX PER CALL</span>
                  <span className="text-base font-bold text-text-primary mt-1 block">
                    ${selectedAgent.maxPerCallUsdc.toFixed(2)} USDC
                  </span>
                </div>
                <div className="p-3 bg-card-elevated rounded-xl border border-border">
                  <span className="text-text-muted block text-[10px]">SPENT THIS CYCLE</span>
                  <span className="text-base font-bold text-emerald-600 dark:text-emerald-400 mt-1 block">
                    ${selectedAgent.spentThisMonthUsdc.toFixed(2)} USDC
                  </span>
                </div>
                <div className="p-3 bg-card-elevated rounded-xl border border-border">
                  <span className="text-text-muted block text-[10px]">MONTHLY CEILING</span>
                  <span className="text-base font-bold text-text-primary mt-1 block">
                    ${selectedAgent.monthlyBudgetUsdc.toFixed(2)} USDC
                  </span>
                </div>
              </div>
            </div>

            {/* INLINE WHITELISTED VENDORS EDITOR */}
            <div className="space-y-3">
              <div className="flex items-center justify-between font-mono text-xs">
                <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted">Whitelisted Providers</h4>
                <span className="text-[10px] text-text-muted">{selectedAgent.allowedVendors.length} active</span>
              </div>

              <div className="flex flex-wrap gap-2">
                {selectedAgent.allowedVendors.map((vendor) => (
                  <span
                    key={vendor}
                    className="inline-flex items-center gap-1.5 bg-accent-violet/10 text-accent-violet border border-accent-violet/25 px-2.5 py-1 rounded-lg text-xs font-mono"
                  >
                    <span>{vendor}</span>
                    <button
                      onClick={() => handleRemoveVendor(vendor)}
                      className="hover:text-red-400 transition cursor-pointer p-0.5 rounded"
                      title="Remove vendor"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>

              {/* Add Vendor Form */}
              <form onSubmit={handleAddVendor} className="flex items-center gap-2 pt-1 font-mono text-xs">
                <input
                  type="text"
                  placeholder="Add vendor domain (e.g. api.openai.com)..."
                  value={newVendorInput}
                  onChange={(e) => setNewVendorInput(e.target.value)}
                  className="flex-1 bg-card-elevated border border-border rounded-xl px-3 py-1.5 text-xs text-text-primary outline-none focus:border-accent-violet"
                />
                <button
                  type="submit"
                  className="bg-accent-violet hover:bg-accent-violet/90 text-white font-bold px-3 py-1.5 rounded-xl transition cursor-pointer shrink-0"
                >
                  + Add
                </button>
              </form>
            </div>

            {/* Solana Onchain Authority Info */}
            <div className="bg-card-elevated p-4 rounded-xl border border-border space-y-2 text-xs font-mono">
              <div className="flex items-center gap-1.5 text-solana font-bold">
                <ShieldCheck size={14} />
                <span>Solana Subscriptions Authority PDA</span>
              </div>
              <p className="text-text-secondary text-[11px] font-sans leading-relaxed">
                Funds remain in the organization treasury. This agent interacts via a constrained PDA allowance vault
                derived from seed <code className="text-text-primary font-mono">["subscription", agent, mint]</code>.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
