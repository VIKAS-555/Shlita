import React, { useState } from 'react';
import {
  Settings,
  ShieldAlert,
  Wallet,
  Globe,
  Users,
  Key,
  Lock,
  AlertTriangle,
} from 'lucide-react';

export const SettingsScreen: React.FC = () => {
  const [autoRevokeOnAnomaly, setAutoRevokeOnAnomaly] = useState(true);
  const [requireMultiSigOver1k, setRequireMultiSigOver1k] = useState(true);
  const [selectedRpc, setSelectedRpc] = useState('https://mainnet.helius-rpc.com/?api-key=...');

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="pb-4 border-b border-border">
        <h2 className="text-xl font-bold text-text-primary tracking-tight">Settings & Security Governance</h2>
        <p className="text-xs text-text-muted mt-1">
          These controls are not connected to the ledger. Nothing on this screen is saved or sent to Solana.
        </p>
      </div>

      {/* Security Policies Box */}
      <div className="bg-card border border-border rounded-2xl p-6 glow-card space-y-4">
        <h3 className="font-bold text-text-primary text-sm flex items-center gap-2">
          <ShieldAlert size={16} className="text-accent-violet" />
          <span>Circuit Breaker & Anomaly Defenses</span>
        </h3>

        <div className="space-y-3 divide-y divide-border/60 text-xs">
          <div className="flex items-center justify-between pt-2">
            <div>
              <span className="font-bold text-text-primary block">Auto-Freeze Agent on Rate Anomaly</span>
              <span className="text-text-muted text-[11px]">
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
              <span className="font-bold text-text-primary block">Enforce Multi-Sig for Withdrawals &gt; $1,000 USDC</span>
              <span className="text-text-muted text-[11px]">
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
        <h3 className="font-bold text-text-primary text-sm flex items-center gap-2">
          <Globe size={16} className="text-solana" />
          <span>Solana Node & Cluster Connection</span>
        </h3>

        <div className="space-y-3 text-xs font-mono">
          <div>
            <label className="text-text-muted block mb-1">PRIMARY RPC ENDPOINT</label>
            <input
              type="text"
              value={selectedRpc}
              onChange={(e) => setSelectedRpc(e.target.value)}
              className="w-full bg-card-elevated border border-border rounded-xl px-3 py-2 text-text-primary outline-none"
            />
          </div>
          <div>
            <label className="text-text-muted block mb-1">SOLANA PROGRAM ID (ALLOWANCE VAULT)</label>
            <input
              type="text"
              disabled
              value="SubScr1pt1ons11111111111111111111111111111111"
              className="w-full bg-card-elevated border border-border text-text-faint rounded-xl px-3 py-2 outline-none cursor-not-allowed"
            />
          </div>
        </div>
      </div>

      {/* Organization Members */}
      <div className="bg-card border border-border rounded-2xl p-6 glow-card space-y-4">
        <h3 className="font-bold text-text-primary text-sm flex items-center gap-2">
          <Users size={16} className="text-cyan-400" />
          <span>Team Roles & Authorities</span>
        </h3>

        <div className="space-y-2 text-xs font-mono">
          <div className="flex items-center justify-between p-3 bg-card-elevated rounded-xl border border-border">
            <div>
              <span className="font-bold text-text-primary block">Arnav Patel (XiaoArnav)</span>
              <span className="text-text-muted text-[10px]">322868724+XiaoArnav@users.noreply.github.com</span>
            </div>
            <span className="bg-accent-violet/20 text-accent-violet px-2 py-0.5 rounded text-[10px] font-bold">
              OWNER / SIGNER
            </span>
          </div>

          <div className="flex items-center justify-between p-3 bg-card-elevated rounded-xl border border-border">
            <div>
              <span className="font-bold text-text-primary block">Jesse (Lead DevOps)</span>
              <span className="text-text-muted text-[10px]">jesse@r1vs.com</span>
            </div>
            <span className="bg-border text-text-secondary px-2 py-0.5 rounded text-[10px]">
              OPERATOR
            </span>
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="button"
            disabled
            className="bg-border text-text-muted font-semibold text-xs px-5 py-2.5 rounded-xl cursor-not-allowed"
          >
            Save is unavailable — no ledger write exists for these controls
          </button>
        </div>
      </div>
    </div>
  );
};
