import React, { useState } from 'react';
import {
  ShieldCheck,
  Plus,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Layers,
  Activity,
  Copy,
  Trash2,
} from 'lucide-react';
import { EnforcementType, SpendingPolicy } from '../../types/dashboard.js';

interface PoliciesScreenProps {
  policies: SpendingPolicy[];
  onAddPolicy: (policy: SpendingPolicy) => void;
}

export const PoliciesScreen: React.FC<PoliciesScreenProps> = ({
  policies,
  onAddPolicy,
}) => {
  const [selectedEnforcement, setSelectedEnforcement] = useState<string>('ALL');
  const [showNewPolicyModal, setShowNewPolicyModal] = useState(false);

  const [newPolicyName, setNewPolicyName] = useState('');
  const [newMaxPerCall, setNewMaxPerCall] = useState('0.10');
  const [newDailyBudget, setNewDailyBudget] = useState('200');
  const [newEnforcement, setNewEnforcement] = useState<EnforcementType>('GATEWAY');

  const filteredPolicies = policies.filter((p) => {
    if (selectedEnforcement === 'ALL') return true;
    return p.enforcementType === selectedEnforcement;
  });

  const handleCreatePolicy = () => {
    const created: SpendingPolicy = {
      id: `pol-${Date.now()}`,
      name: newPolicyName || 'Custom Policy Guardrail',
      tier: 'Custom Tier',
      enforcementType: newEnforcement,
      maxPerCallUsdc: Number(newMaxPerCall) || 0.10,
      dailyBudgetUsdc: Number(newDailyBudget) || 200,
      monthlyBudgetUsdc: (Number(newDailyBudget) || 200) * 10,
      autoApproveLimitUsdc: 50.00,
      humanReviewThresholdUsdc: 250.00,
      allowedTokens: ['USDC'],
      allowedVendors: ['api.helius.xyz', 'api.tavily.com'],
      blockedVendors: ['drainer.io'],
      assignedAgentsCount: 1,
      circuitBreaker: {
        maxConsecutiveErrors: 2,
        maxCallsPerMinute: 10,
      },
    };
    onAddPolicy(created);
    setShowNewPolicyModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Spending Policies & Guardrails</h2>
          <p className="text-xs text-slate-400 mt-1">
            Configure financial bounds, vendor whitelists, and circuit breaker trip thresholds.
          </p>
        </div>
        <button
          onClick={() => setShowNewPolicyModal(true)}
          className="flex items-center space-x-2 bg-gradient-to-r from-accent-violet to-solana-purple hover:opacity-95 text-white font-semibold text-xs px-4 py-2.5 rounded-xl shadow-lg shadow-accent-violet/20 transition cursor-pointer"
        >
          <Plus size={16} />
          <span>New Spending Policy</span>
        </button>
      </div>

      {/* Enforcement Architecture Banner (Crucial Requirement) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* On-Chain Tier */}
        <div className="bg-card border border-solana/30 rounded-xl p-4 relative overflow-hidden">
          <div className="flex items-center space-x-2 text-solana text-xs font-bold font-mono">
            <span className="w-2 h-2 rounded-full bg-solana"></span>
            <span>1. ON-CHAIN ENFORCEMENT</span>
          </div>
          <p className="text-xs text-slate-300 mt-2">
            Enforced by the official <strong>@solana/subscriptions</strong> Anchor program. Total spending caps and
            allowance revocations are cryptographic invariants on Solana ledger.
          </p>
          <span className="inline-block mt-3 text-[10px] bg-solana/10 text-solana px-2 py-0.5 rounded font-mono">
            Cryptographic Guarantee
          </span>
        </div>

        {/* Gateway Tier */}
        <div className="bg-card border border-accent-violet/30 rounded-xl p-4 relative overflow-hidden">
          <div className="flex items-center space-x-2 text-accent-violet text-xs font-bold font-mono">
            <span className="w-2 h-2 rounded-full bg-accent-violet"></span>
            <span>2. GATEWAY ENFORCEMENT</span>
          </div>
          <p className="text-xs text-slate-300 mt-2">
            Evaluated at the Shlita Policy Proxy in sub-milliseconds. Inspects per-call payload limits, whitelisted vendor
            domains, and rolling frequency circuit breakers before network dispatch.
          </p>
          <span className="inline-block mt-3 text-[10px] bg-accent-violet/10 text-accent-violet px-2 py-0.5 rounded font-mono">
            Perimeter Defense
          </span>
        </div>

        {/* Off-Chain Monitoring */}
        <div className="bg-card border border-border rounded-xl p-4 relative overflow-hidden">
          <div className="flex items-center space-x-2 text-cyan-400 text-xs font-bold font-mono">
            <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
            <span>3. OFF-CHAIN MONITORING</span>
          </div>
          <p className="text-xs text-slate-300 mt-2">
            Asynchronous event reconciler. Dispatches webhook notifications, generates anomaly alerts, and flags suspicious
            spikes for human multi-sig review.
          </p>
          <span className="inline-block mt-3 text-[10px] bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded font-mono">
            Telemetry & Audit
          </span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center space-x-2 text-xs font-mono">
        {(['ALL', 'ON_CHAIN', 'GATEWAY', 'OFF_CHAIN_ALERT'] as const).map((tier) => (
          <button
            key={tier}
            onClick={() => setSelectedEnforcement(tier)}
            className={`px-3 py-1.5 rounded-xl border transition ${
              selectedEnforcement === tier
                ? 'bg-accent-violet text-white font-semibold border-accent-violet'
                : 'bg-card border-border text-slate-400 hover:text-white'
            }`}
          >
            {tier === 'ALL' ? 'All Policies' : tier.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Policy Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredPolicies.map((policy) => {
          const badgeColor =
            policy.enforcementType === 'ON_CHAIN'
              ? 'bg-solana/10 text-solana border-solana/30'
              : policy.enforcementType === 'GATEWAY'
              ? 'bg-accent-violet/10 text-accent-violet border-accent-violet/30'
              : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30';

          return (
            <div
              key={policy.id}
              className="bg-card border border-border rounded-2xl p-6 glow-card space-y-4 hover:border-slate-700 transition"
            >
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">{policy.tier}</span>
                  <h3 className="text-base font-bold text-white mt-0.5">{policy.name}</h3>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold border ${badgeColor}`}>
                  {policy.enforcementType}
                </span>
              </div>

              {/* Financial Constraints Matrix */}
              <div className="grid grid-cols-2 gap-3 text-xs font-mono bg-slate-900/80 p-3.5 rounded-xl border border-border/80">
                <div>
                  <span className="text-slate-400 block text-[10px]">MAX PER CALL</span>
                  <span className="text-white font-bold text-sm">${policy.maxPerCallUsdc.toFixed(2)} USDC</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">DAILY BUDGET</span>
                  <span className="text-white font-bold text-sm">${policy.dailyBudgetUsdc.toFixed(2)} USDC</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">AUTO-APPROVE UNDER</span>
                  <span className="text-emerald-400 font-bold">${policy.autoApproveLimitUsdc.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">HUMAN REVIEW OVER</span>
                  <span className="text-amber-400 font-bold">${policy.humanReviewThresholdUsdc.toFixed(2)}</span>
                </div>
              </div>

              {/* Circuit Breaker Spec */}
              <div className="space-y-1.5 text-xs font-mono bg-slate-950 p-3 rounded-xl border border-border">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">
                  Automated Circuit Breaker
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Max Calls / Minute:</span>
                  <span className="text-solana font-bold">{policy.circuitBreaker.maxCallsPerMinute} calls/min</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Consecutive Error Threshold:</span>
                  <span className="text-red-400 font-bold">{policy.circuitBreaker.maxConsecutiveErrors} errors</span>
                </div>
              </div>

              {/* Allowed Vendors */}
              <div>
                <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block mb-1.5">
                  Allowed Vendors:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {policy.allowedVendors.map((v) => (
                    <span
                      key={v}
                      className="bg-slate-800 text-slate-300 border border-border px-2 py-0.5 rounded text-[10px] font-mono"
                    >
                      {v}
                    </span>
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-border/80 text-xs text-slate-400 font-mono">
                <span>{policy.assignedAgentsCount} active agents assigned</span>
                <div className="flex items-center space-x-2">
                  <button className="hover:text-white p-1 rounded transition" title="Duplicate">
                    <Copy size={14} />
                  </button>
                  <button className="hover:text-red-400 p-1 rounded transition" title="Delete">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* New Policy Modal */}
      {showNewPolicyModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border w-full max-w-lg rounded-2xl p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <h3 className="font-bold text-white text-base">Create Spending Policy</h3>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Policy Name</label>
              <input
                type="text"
                placeholder="e.g. Data Extraction Fast-Path"
                value={newPolicyName}
                onChange={(e) => setNewPolicyName(e.target.value)}
                className="w-full bg-slate-900 border border-border rounded-xl px-3 py-2 text-xs text-white outline-none font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Max Per Call ($)</label>
                <input
                  type="number"
                  value={newMaxPerCall}
                  onChange={(e) => setNewMaxPerCall(e.target.value)}
                  className="w-full bg-slate-900 border border-border rounded-xl px-3 py-2 text-xs text-white outline-none font-mono"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Daily Limit ($)</label>
                <input
                  type="number"
                  value={newDailyBudget}
                  onChange={(e) => setNewDailyBudget(e.target.value)}
                  className="w-full bg-slate-900 border border-border rounded-xl px-3 py-2 text-xs text-white outline-none font-mono"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Enforcement Layer</label>
              <select
                value={newEnforcement}
                onChange={(e) => setNewEnforcement(e.target.value as any)}
                className="w-full bg-slate-900 border border-border rounded-xl px-3 py-2 text-xs text-white outline-none font-mono"
              >
                <option value="GATEWAY">GATEWAY ENFORCEMENT (Sub-ms perimeter proxy)</option>
                <option value="ON_CHAIN">ON-CHAIN ENFORCEMENT (Solana Subscriptions PDA)</option>
                <option value="OFF_CHAIN_ALERT">OFF-CHAIN MONITORING (Alerts only)</option>
              </select>
            </div>

            <div className="flex justify-end space-x-3 pt-3 border-t border-border">
              <button
                onClick={() => setShowNewPolicyModal(false)}
                className="px-4 py-2 text-xs text-slate-400 hover:text-white transition"
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePolicy}
                className="bg-accent-violet hover:bg-accent-violet/90 text-white font-semibold text-xs px-4 py-2 rounded-xl transition"
              >
                Create Policy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
