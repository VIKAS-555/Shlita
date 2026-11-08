import React, { useState } from 'react';
import {
  Settings,
  ShieldAlert,
  Wallet,
  Globe,
  Users,
  Key,
  Lock,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

export const SettingsScreen: React.FC = () => {
  const [autoRevokeOnAnomaly, setAutoRevokeOnAnomaly] = useState(true);
  const [requireMultiSigOver1k, setRequireMultiSigOver1k] = useState(true);
  const [selectedRpc, setSelectedRpc] = useState('https://mainnet.helius-rpc.com/?api-key=...');
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSave = () => {
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="pb-4 border-b border-border">
        <h2 className="text-xl font-bold text-white tracking-tight">Settings & Security Governance</h2>
        <p className="text-xs text-slate-400 mt-1">
          Manage workspace access, on-chain Solana RPC endpoints, and autonomous agent kill-switches.
        </p>
      </div>

      {savedSuccess && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl text-xs flex items-center gap-2 font-mono">
          <CheckCircle2 size={16} />
          <span>Security preferences updated and synchronized on-chain.</span>
        </div>
      )}

      {/* Security Policies Box */}
      <div className="bg-card border border-border rounded-2xl p-6 glow-card space-y-4">
        <h3 className="font-bold text-white text-sm flex items-center gap-2">
          <ShieldAlert size={16} className="text-accent-violet" />
          <span>Circuit Breaker & Anomaly Defenses</span>
        </h3>

        <div className="space-y-3 divide-y divide-border/60 text-xs">
          <div className="flex items-center justify-between pt-2">
            <div>
              <span className="font-bold text-white block">Auto-Freeze Agent on Rate Anomaly</span>
              <span className="text-slate-400 text-[11px]">
                Immediately suspend an agent if it fires more than its configured call frequency limit within 60 seconds.
              </span>
            </div>
            <input
              type="checkbox"
              checked={autoRevokeOnAnomaly}
              onChange={(e) => setAutoRevokeOnAnomaly(e.target.checked)}
              className="accent-accent-violet h-4 w-4"
            />
          </div>

          <div className="flex items-center justify-between pt-3">
            <div>
              <span className="font-bold text-white block">Enforce Multi-Sig for Withdrawals &gt; $1,000 USDC</span>
              <span className="text-slate-400 text-[11px]">
                Require Squads multi-sig co-signature before modifying top-level treasury allowance vaults.
              </span>
            </div>
            <input
              type="checkbox"
              checked={requireMultiSigOver1k}
              onChange={(e) => setRequireMultiSigOver1k(e.target.checked)}
              className="accent-accent-violet h-4 w-4"
            />
          </div>
        </div>
      </div>

      {/* Solana Network & RPC Configuration */}
      <div className="bg-card border border-border rounded-2xl p-6 glow-card space-y-4">
        <h3 className="font-bold text-white text-sm flex items-center gap-2">
          <Globe size={16} className="text-solana" />
          <span>Solana Node & Cluster Connection</span>
        </h3>

        <div className="space-y-3 text-xs font-mono">
          <div>
            <label className="text-slate-400 block mb-1">PRIMARY RPC ENDPOINT</label>
            <input
              type="text"
              value={selectedRpc}
              onChange={(e) => setSelectedRpc(e.target.value)}
              className="w-full bg-slate-950 border border-border rounded-xl px-3 py-2 text-white outline-none"
            />
          </div>
          <div>
            <label className="text-slate-400 block mb-1">SOLANA PROGRAM ID (ALLOWANCE VAULT)</label>
            <input
              type="text"
              disabled
              value="SubScr1pt1ons11111111111111111111111111111111"
              className="w-full bg-slate-900 border border-border text-slate-500 rounded-xl px-3 py-2 outline-none cursor-not-allowed"
            />
          </div>
        </div>
      </div>

      {/* Organization Members */}
      <div className="bg-card border border-border rounded-2xl p-6 glow-card space-y-4">
        <h3 className="font-bold text-white text-sm flex items-center gap-2">
          <Users size={16} className="text-cyan-400" />
          <span>Team Roles & Authorities</span>
        </h3>

        <div className="space-y-2 text-xs font-mono">
          <div className="flex items-center justify-between p-3 bg-slate-950 rounded-xl border border-border">
            <div>
              <span className="font-bold text-white block">Arnav Patel (XiaoArnav)</span>
              <span className="text-slate-400 text-[10px]">322868724+XiaoArnav@users.noreply.github.com</span>
            </div>
            <span className="bg-accent-violet/20 text-accent-violet px-2 py-0.5 rounded text-[10px] font-bold">
              OWNER / SIGNER
            </span>
          </div>

          <div className="flex items-center justify-between p-3 bg-slate-950 rounded-xl border border-border">
            <div>
              <span className="font-bold text-white block">Jesse (Lead DevOps)</span>
              <span className="text-slate-400 text-[10px]">jesse@r1vs.com</span>
            </div>
            <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[10px]">
              OPERATOR
            </span>
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            onClick={handleSave}
            className="bg-accent-violet hover:bg-accent-violet/90 text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-lg shadow-accent-violet/20 transition cursor-pointer"
          >
            Save Security Changes
          </button>
        </div>
      </div>
    </div>
  );
};
