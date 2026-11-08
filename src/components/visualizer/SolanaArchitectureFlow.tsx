import React, { useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Bot,
  Cpu,
  Lock,
  ArrowRight,
  Sparkles,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Users,
  Play,
  RotateCcw,
  Info,
  X,
} from 'lucide-react';
import { sounds } from '../../utils/audio.js';

export type FlowState = 'IDLE' | 'AUTHORIZED' | 'BLOCKED' | 'CIRCUIT_TRIPPED' | 'MULTISIG';

interface SolanaArchitectureFlowProps {
  initialState?: FlowState;
  onStateChange?: (state: FlowState) => void;
}

export const SolanaArchitectureFlow: React.FC<SolanaArchitectureFlowProps> = ({
  initialState = 'IDLE',
  onStateChange,
}) => {
  const [activeState, setActiveState] = useState<FlowState>(initialState);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const setFlow = (state: FlowState) => {
    setActiveState(state);
    if (onStateChange) onStateChange(state);

    if (state === 'AUTHORIZED') sounds.playSuccess();
    else if (state === 'BLOCKED') sounds.playBlocked();
    else if (state === 'CIRCUIT_TRIPPED') sounds.playCircuitHum();
    else if (state === 'MULTISIG') sounds.playMultiSigLock();
    else sounds.playClick();
  };

  const nodeDetails: Record<
    string,
    { title: string; subtitle: string; spec: string[]; solanaAddress?: string }
  > = {
    agent: {
      title: 'Autonomous AI Agent Runtime',
      subtitle: 'Actor Layer (LangChain / AutoGPT / MCP Server)',
      spec: [
        'Signs tool invocations via isolated session keys',
        'Has zero direct access to raw treasury private keys',
        'Requests outbound paid API calls via Shlita reverse proxy',
      ],
      solanaAddress: 'Rsr4Wb7Kq...11Zx (Agent Wallet)',
    },
    perimeter: {
      title: 'Shlita Policy Gateway & Firewall',
      subtitle: 'Sub-Millisecond Edge Enforcement Layer',
      spec: [
        'Evaluates per-call limit (e.g. $0.05 USDC max)',
        'Inspects target vendor domain whitelist',
        'Sliding-window rate limiter & automatic circuit breaker',
        'Redirects >$500.00 calls to Squads Multi-Sig governance seam',
      ],
      solanaAddress: 'https://api.shlita.finance/v1/proxy',
    },
    squads: {
      title: 'Squads v4 Multi-Sig Vault',
      subtitle: 'On-Chain Ed25519 Governance Threshold (2/3)',
      spec: [
        'Owner Signer: XiaoArnav (Primary Authority)',
        'DevOps Signer: Jesse (Secondary Co-Signer)',
        'Cold Vault Signer: Offline hardware key',
        'Required for allowance increases & unwhitelisted vendor additions',
      ],
      solanaAddress: 'SQDS4v4M1ts...88xK (Squads Vault)',
    },
    pda: {
      title: 'Solana Subscriptions Authority PDA',
      subtitle: '@solana/subscriptions Program Derived Address',
      spec: [
        'Seeds: ["SubscriptionAuthority", user, token_mint]',
        'Canonical Program ID: De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44',
        'Cryptographic Guarantee: Merchant can only claim within non-custodial cap',
        'Zero delegate collisions on SPL Token accounts',
      ],
      solanaAddress: 'De1egAF...subscriptions_authority',
    },
    merchant: {
      title: 'Merchant Associated Token Account (ATA)',
      subtitle: 'Vendor Receiving Vault (USDC SPL Token)',
      spec: [
        'Whitelisted vendor endpoint (e.g. Helius RPC, Tavily API)',
        'Collects exact micro-settlements upon successful API execution',
        'No direct chargebacks or charge leakage',
      ],
      solanaAddress: 'HeliusATA99...Xy (Merchant ATA)',
    },
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-5 font-mono text-xs overflow-hidden relative">
      {/* Visualizer Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-border gap-3">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-xl bg-solana/10 text-solana border border-solana/25">
            <Zap size={16} />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="font-bold text-sm text-text-primary tracking-tight">
                Live Solana Architecture & Cryptographic Flow
              </h3>
              <span className="text-[10px] bg-solana/15 text-solana px-2 py-0.5 rounded-full font-bold">
                NON-CUSTODIAL
              </span>
            </div>
            <p className="text-[11px] text-text-muted mt-0.5">
              Interactive node graph: trace packets from autonomous agent runtime through Shlita perimeter to on-chain PDA settlement.
            </p>
          </div>
        </div>

        {/* State Simulator Preset Buttons */}
        <div className="flex flex-wrap items-center gap-1.5 self-start sm:self-auto">
          <button
            onClick={() => setFlow('AUTHORIZED')}
            className={`px-2.5 py-1 rounded-lg border transition cursor-pointer text-[11px] font-bold ${
              activeState === 'AUTHORIZED'
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-sm'
                : 'bg-card-elevated text-text-muted border-border hover:text-emerald-400'
            }`}
          >
            ✓ Authorized Call
          </button>
          <button
            onClick={() => setFlow('BLOCKED')}
            className={`px-2.5 py-1 rounded-lg border transition cursor-pointer text-[11px] font-bold ${
              activeState === 'BLOCKED'
                ? 'bg-red-500/20 text-red-400 border-red-500/40 shadow-sm'
                : 'bg-card-elevated text-text-muted border-border hover:text-red-400'
            }`}
          >
            ✕ Intercept Exploit
          </button>
          <button
            onClick={() => setFlow('CIRCUIT_TRIPPED')}
            className={`px-2.5 py-1 rounded-lg border transition cursor-pointer text-[11px] font-bold ${
              activeState === 'CIRCUIT_TRIPPED'
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/40 shadow-sm'
                : 'bg-card-elevated text-text-muted border-border hover:text-amber-400'
            }`}
          >
            ⚡ Trip Circuit
          </button>
          <button
            onClick={() => setFlow('MULTISIG')}
            className={`px-2.5 py-1 rounded-lg border transition cursor-pointer text-[11px] font-bold ${
              activeState === 'MULTISIG'
                ? 'bg-accent-violet/20 text-accent-violet border-accent-violet/40 shadow-sm'
                : 'bg-card-elevated text-text-muted border-border hover:text-accent-violet'
            }`}
          >
            👥 Squads Multi-Sig
          </button>
          <button
            onClick={() => setFlow('IDLE')}
            className="p-1.5 rounded-lg bg-card-elevated text-text-muted hover:text-text-primary border border-border transition cursor-pointer"
            title="Reset to Idle"
          >
            <RotateCcw size={12} />
          </button>
        </div>
      </div>

      {/* SVG Interactive Animated Node Canvas */}
      <div className="relative py-4 px-2 overflow-x-auto min-w-[700px]">
        {/* Node Grid Layout */}
        <div className="grid grid-cols-4 gap-4 relative z-10">
          {/* Node 1: Agent Runtime */}
          <div
            onClick={() => setSelectedNode('agent')}
            className={`bg-[#0C0E14] border rounded-2xl p-4 transition-all duration-300 cursor-pointer relative group ${
              selectedNode === 'agent'
                ? 'border-solana shadow-lg shadow-solana/10 ring-1 ring-solana'
                : 'border-border hover:border-solana/50'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-text-muted uppercase tracking-wider">1. ACTOR</span>
              <Bot size={16} className="text-solana" />
            </div>
            <div className="font-bold text-text-primary text-xs truncate">AI Agent Runtime</div>
            <div className="text-[10px] text-text-muted truncate mt-0.5">Rsr4Wb...11Zx</div>
            <div className="mt-3 pt-2 border-t border-border/60 flex items-center justify-between text-[10px]">
              <span className="text-text-muted">Payload:</span>
              <span className="text-emerald-400 font-bold">$0.02 USDC</span>
            </div>
          </div>

          {/* Node 2: Shlita Policy Perimeter */}
          <div
            onClick={() => setSelectedNode('perimeter')}
            className={`bg-[#0C0E14] border rounded-2xl p-4 transition-all duration-300 cursor-pointer relative group ${
              activeState === 'BLOCKED'
                ? 'border-red-500 shadow-xl shadow-red-500/20 ring-2 ring-red-500 animate-pulse'
                : activeState === 'CIRCUIT_TRIPPED'
                ? 'border-amber-500 shadow-xl shadow-amber-500/20 ring-2 ring-amber-500 animate-pulse'
                : selectedNode === 'perimeter'
                ? 'border-accent-violet shadow-lg shadow-accent-violet/10 ring-1 ring-accent-violet'
                : 'border-border hover:border-accent-violet/50'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-text-muted uppercase tracking-wider">2. PERIMETER</span>
              {activeState === 'BLOCKED' ? (
                <ShieldAlert size={16} className="text-red-500 animate-bounce" />
              ) : (
                <ShieldCheck size={16} className="text-accent-violet" />
              )}
            </div>
            <div className="font-bold text-text-primary text-xs truncate">Policy Firewall</div>
            <div className="text-[10px] text-text-muted truncate mt-0.5">Sub-ms Reverse Proxy</div>
            <div className="mt-3 pt-2 border-t border-border/60 flex items-center justify-between text-[10px]">
              <span className="text-text-muted">Status:</span>
              <span
                className={`font-bold ${
                  activeState === 'BLOCKED'
                    ? 'text-red-400'
                    : activeState === 'CIRCUIT_TRIPPED'
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                }`}
              >
                {activeState === 'BLOCKED'
                  ? 'INTERCEPTED (403)'
                  : activeState === 'CIRCUIT_TRIPPED'
                  ? 'TRIPPED (429)'
                  : 'ACTIVE (0.12ms)'}
              </span>
            </div>
          </div>

          {/* Node 3: Solana Subscriptions PDA */}
          <div
            onClick={() => setSelectedNode('pda')}
            className={`bg-[#0C0E14] border rounded-2xl p-4 transition-all duration-300 cursor-pointer relative group ${
              activeState === 'AUTHORIZED' || activeState === 'MULTISIG'
                ? 'border-solana shadow-xl shadow-solana/20 ring-2 ring-solana'
                : selectedNode === 'pda'
                ? 'border-solana shadow-lg shadow-solana/10 ring-1 ring-solana'
                : 'border-border hover:border-solana/50'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-text-muted uppercase tracking-wider">3. ON-CHAIN PDA</span>
              <Lock size={16} className="text-solana" />
            </div>
            <div className="font-bold text-text-primary text-xs truncate">Subscriptions Authority</div>
            <div className="text-[10px] text-text-muted truncate mt-0.5">Bump 254 • Non-Custodial</div>
            <div className="mt-3 pt-2 border-t border-border/60 flex items-center justify-between text-[10px]">
              <span className="text-text-muted">Protocol:</span>
              <span className="text-solana font-bold">@solana/subscriptions</span>
            </div>
          </div>

          {/* Node 4: Merchant ATA */}
          <div
            onClick={() => setSelectedNode('merchant')}
            className={`bg-[#0C0E14] border rounded-2xl p-4 transition-all duration-300 cursor-pointer relative group ${
              activeState === 'AUTHORIZED' || activeState === 'MULTISIG'
                ? 'border-emerald-500 shadow-xl shadow-emerald-500/20 ring-1 ring-emerald-500'
                : selectedNode === 'merchant'
                ? 'border-emerald-500 shadow-lg'
                : 'border-border hover:border-emerald-500/50'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-text-muted uppercase tracking-wider">4. SETTLEMENT</span>
              <CheckCircle2 size={16} className="text-emerald-400" />
            </div>
            <div className="font-bold text-text-primary text-xs truncate">Merchant ATA</div>
            <div className="text-[10px] text-text-muted truncate mt-0.5">Helius / Tavily USDC Vault</div>
            <div className="mt-3 pt-2 border-t border-border/60 flex items-center justify-between text-[10px]">
              <span className="text-text-muted">Received:</span>
              <span className="text-text-primary font-bold">
                {activeState === 'AUTHORIZED' ? '+$0.020 USDC' : activeState === 'MULTISIG' ? '+$6,200.00' : '$0.00'}
              </span>
            </div>
          </div>
        </div>

        {/* Squads Multi-Sig Bypass Branch (Rendered when MultiSig or clicked) */}
        <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between bg-card-elevated/40 p-3 rounded-xl">
          <div
            onClick={() => setSelectedNode('squads')}
            className={`flex items-center space-x-3 cursor-pointer p-1 rounded-lg transition ${
              selectedNode === 'squads' ? 'text-accent-violet font-bold' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <div className="w-6 h-6 rounded-lg bg-accent-violet/15 text-accent-violet flex items-center justify-center font-bold text-xs">
              <Users size={13} />
            </div>
            <div>
              <span className="font-bold text-text-primary">Squads v4 Multi-Sig Vault (SQDS4...88xK)</span>
              <span className="text-[10px] text-text-muted block">
                2/3 Co-Signature Seam: Intercepts & authorizes requests &gt; $500.00 USDC
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <span
              className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded-full ${
                activeState === 'MULTISIG'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-accent-violet/15 text-accent-violet'
              }`}
            >
              {activeState === 'MULTISIG' ? '2/3 THRESHOLD MET (CONFIRMED ✔)' : 'GOVERNANCE SEAM READY'}
            </span>
          </div>
        </div>

        {/* Active Simulation State Banner */}
        <div className="mt-3">
          {activeState === 'AUTHORIZED' && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-between text-emerald-400 animate-in fade-in">
              <div className="flex items-center space-x-2">
                <CheckCircle2 size={15} />
                <span className="font-bold">
                  ✓ In-Policy Call Settled: research-agent-01 paid $0.020 USDC to Helius RPC via Solana Subscriptions PDA.
                </span>
              </div>
              <span className="text-[10px] bg-emerald-500/20 px-2 py-0.5 rounded font-mono">
                Latency: 0.14ms • Network Fee: 0.000005 SOL
              </span>
            </div>
          )}

          {activeState === 'BLOCKED' && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center justify-between text-red-400 animate-in fade-in">
              <div className="flex items-center space-x-2">
                <ShieldAlert size={15} />
                <span className="font-bold">
                  ✕ Exploit Blocked at Perimeter: Request ($0.080 USDC) exceeded policy cap ($0.050 USDC). Zero funds leaked.
                </span>
              </div>
              <span className="text-[10px] bg-red-500/20 px-2 py-0.5 rounded font-mono">
                Treasury Saved: $0.080 • HTTP 403
              </span>
            </div>
          )}

          {activeState === 'CIRCUIT_TRIPPED' && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between text-amber-400 animate-in fade-in">
              <div className="flex items-center space-x-2">
                <AlertTriangle size={15} />
                <span className="font-bold">
                  ⚡ Circuit Breaker Engaged: Velocity limit exceeded (14 calls/min &gt; 12/min). Agent auto-frozen.
                </span>
              </div>
              <span className="text-[10px] bg-amber-500/20 px-2 py-0.5 rounded font-mono">
                Loop Blocked • HTTP 429
              </span>
            </div>
          )}

          {activeState === 'MULTISIG' && (
            <div className="p-3 bg-accent-violet/10 border border-accent-violet/30 rounded-xl flex items-center justify-between text-accent-violet animate-in fade-in">
              <div className="flex items-center space-x-2">
                <Users size={15} />
                <span className="font-bold">
                  👥 Squads Multi-Sig Approved: 2-of-3 Ed25519 co-signatures collected (XiaoArnav + Jesse). $6,200.00 allowance settled.
                </span>
              </div>
              <span className="text-[10px] bg-accent-violet/20 px-2 py-0.5 rounded font-mono">
                Program SQDS4...88xK • HTTP 200
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Node Inspector Drawer Modal */}
      {selectedNode && nodeDetails[selectedNode] && (
        <div className="p-4 bg-card-elevated border border-border rounded-xl space-y-2 animate-in fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Info size={14} className="text-solana" />
              <span className="font-bold text-text-primary text-xs">
                {nodeDetails[selectedNode].title}
              </span>
              <span className="text-[10px] text-text-muted font-mono">
                ({nodeDetails[selectedNode].subtitle})
              </span>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-text-muted hover:text-text-primary p-0.5 rounded cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>

          <ul className="space-y-1 text-[11px] text-text-secondary pl-4 list-disc">
            {nodeDetails[selectedNode].spec.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>

          {nodeDetails[selectedNode].solanaAddress && (
            <div className="pt-2 border-t border-border/60 text-[10px] text-text-muted flex items-center justify-between">
              <span>On-Chain Key / Seam:</span>
              <span className="text-solana font-mono font-bold">
                {nodeDetails[selectedNode].solanaAddress}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
