import React, { useState } from 'react';
import {
  X,
  Bot,
  ShieldCheck,
  Wallet,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
} from 'lucide-react';
import { Agent } from '../../types/dashboard.js';

interface CreateAgentWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateAgent: (agent: Agent) => void;
}

export const CreateAgentWizard: React.FC<CreateAgentWizardProps> = ({
  isOpen,
  onClose,
  onCreateAgent,
}) => {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [environment, setEnvironment] = useState<'Production' | 'Staging' | 'Development'>('Production');
  const [mode, setMode] = useState<'Runner' | 'Caller'>('Runner');
  const [dailyBudget, setDailyBudget] = useState('100');
  const [monthlyBudget, setMonthlyBudget] = useState('1000');
  const [maxPerCall, setMaxPerCall] = useState('10');
  const [selectedVendors, setSelectedVendors] = useState<string[]>([
    'api.helius.xyz',
    'api.tavily.com',
  ]);
  const [isSigning, setIsSigning] = useState(false);
  const [signed, setSigned] = useState(false);

  if (!isOpen) return null;

  const vendorOptions = [
    { id: 'api.helius.xyz', name: 'Helius RPC & DAS', category: 'Solana Infrastructure' },
    { id: 'api.tavily.com', name: 'Tavily Search API', category: 'AI Web Search' },
    { id: 'api.jup.ag', name: 'Jupiter DEX Routing', category: 'Liquidity Rails' },
    { id: 'api.pyth.network', name: 'Pyth Oracles', category: 'Price Feeds' },
    { id: 'api.vercel.com', name: 'Vercel Deployment', category: 'Dev Tools' },
    { id: 'api.aws.amazon.com', name: 'AWS Cloud APIs', category: 'Cloud Infrastructure' },
  ];

  const toggleVendor = (id: string) => {
    if (selectedVendors.includes(id)) {
      setSelectedVendors(selectedVendors.filter((v) => v !== id));
    } else {
      setSelectedVendors([...selectedVendors, id]);
    }
  };

  const handleSignAndCreate = () => {
    setIsSigning(true);
    setTimeout(() => {
      setIsSigning(false);
      setSigned(true);
      setTimeout(() => {
        const newAgent: Agent = {
          id: `agent-${Date.now()}`,
          name: name || 'autonomous-agent-new',
          description: description || 'Autonomous workflow runner configured via AutoStream',
          avatar: '🤖',
          environment,
          version: '1.0.0',
          mode,
          connection: 'AutoStream Gateway Proxy',
          status: 'ACTIVE',
          walletAddress: `AuSt${Math.random().toString(36).substring(2, 6).toUpperCase()}...88Xp`,
          dailyBudgetUsdc: Number(dailyBudget) || 100,
          monthlyBudgetUsdc: Number(monthlyBudget) || 1000,
          spentThisMonthUsdc: 0.0,
          maxPerCallUsdc: Number(maxPerCall) || 10,
          allowedVendors: selectedVendors,
          lastActive: 'Just registered',
        };
        onCreateAgent(newAgent);
        onClose();
        setStep(1);
        setSigned(false);
      }, 700);
    }, 1000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border w-full max-w-2xl rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Wizard Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card-elevated">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-accent-violet/15 border border-accent-violet/30 text-accent-violet flex items-center justify-center">
              <Bot size={18} />
            </div>
            <div>
              <h3 className="font-bold text-text-primary text-base">Create Autonomous Agent</h3>
              <p className="text-xs text-text-muted">Step {step} of 4</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-text-muted hover:text-text-primary transition">
            <X size={18} />
          </button>
        </div>

        {/* Step Progress Indicators */}
        <div className="grid grid-cols-4 border-b border-border text-center text-xs font-mono">
          <div className={`py-2.5 border-b-2 transition ${step === 1 ? 'border-accent-violet text-text-primary font-bold bg-accent-violet/[0.05]' : 'border-transparent text-text-muted'}`}>
            1. Identity
          </div>
          <div className={`py-2.5 border-b-2 transition ${step === 2 ? 'border-accent-violet text-text-primary font-bold bg-accent-violet/[0.05]' : 'border-transparent text-text-muted'}`}>
            2. Budgets
          </div>
          <div className={`py-2.5 border-b-2 transition ${step === 3 ? 'border-accent-violet text-text-primary font-bold bg-accent-violet/[0.05]' : 'border-transparent text-text-muted'}`}>
            3. Providers
          </div>
          <div className={`py-2.5 border-b-2 transition ${step === 4 ? 'border-accent-violet text-text-primary font-bold bg-accent-violet/[0.05]' : 'border-transparent text-text-muted'}`}>
            4. Authorize
          </div>
        </div>

        {/* Wizard Step Body */}
        <div className="p-6 space-y-4">
          {/* STEP 1: IDENTITY */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-text-secondary block mb-1">Agent Name</label>
                <input
                  type="text"
                  placeholder="e.g. data-research-agent-01"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-card-elevated border border-border focus:border-accent-violet rounded-xl px-4 py-2.5 text-xs text-text-primary placeholder-text-muted outline-none font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-text-secondary block mb-1">Description & Objective</label>
                <textarea
                  rows={2}
                  placeholder="What tasks does this agent perform? Which tools does it execute?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-card-elevated border border-border focus:border-accent-violet rounded-xl px-4 py-2 text-xs text-text-primary placeholder-text-muted outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-text-secondary block mb-1">Target Environment</label>
                  <select
                    value={environment}
                    onChange={(e) => setEnvironment(e.target.value as any)}
                    className="w-full bg-card-elevated border border-border rounded-xl px-3 py-2 text-xs text-text-primary outline-none font-mono"
                  >
                    <option value="Production">Production</option>
                    <option value="Staging">Staging</option>
                    <option value="Development">Development</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-text-secondary block mb-1">Execution Mode</label>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as any)}
                    className="w-full bg-card-elevated border border-border rounded-xl px-3 py-2 text-xs text-text-primary outline-none font-mono"
                  >
                    <option value="Runner">Runner (Autonomous loops)</option>
                    <option value="Caller">Caller (Prompt tool calls)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: SPENDING CONFIG */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-text-secondary block mb-1">Monthly Limit ($)</label>
                  <input
                    type="number"
                    value={monthlyBudget}
                    onChange={(e) => setMonthlyBudget(e.target.value)}
                    className="w-full bg-card-elevated border border-border focus:border-accent-violet rounded-xl px-3 py-2 text-xs text-text-primary font-mono outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-text-secondary block mb-1">Daily Limit ($)</label>
                  <input
                    type="number"
                    value={dailyBudget}
                    onChange={(e) => setDailyBudget(e.target.value)}
                    className="w-full bg-card-elevated border border-border focus:border-accent-violet rounded-xl px-3 py-2 text-xs text-text-primary font-mono outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-text-secondary block mb-1">Max Per Call ($)</label>
                  <input
                    type="number"
                    value={maxPerCall}
                    onChange={(e) => setMaxPerCall(e.target.value)}
                    className="w-full bg-card-elevated border border-border focus:border-accent-violet rounded-xl px-3 py-2 text-xs text-text-primary font-mono outline-none"
                  />
                </div>
              </div>

              <div className="bg-card-elevated p-4 rounded-xl border border-border text-xs space-y-2">
                <span className="font-semibold text-text-primary block">Permitted Stablecoin Tokens:</span>
                <div className="flex gap-2">
                  <span className="bg-solana/10 text-solana border border-solana/30 px-3 py-1 rounded-lg font-mono">
                    USDC (SPL Token)
                  </span>
                  <span className="bg-card text-text-muted border border-border px-3 py-1 rounded-lg font-mono">
                    USDT (Optional)
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: PROVIDER PERMISSIONS */}
          {step === 3 && (
            <div className="space-y-3">
              <p className="text-xs text-text-muted">
                Select the external services this agent is authorized to interact with and pay:
              </p>
              <div className="grid grid-cols-2 gap-2.5 max-h-60 overflow-y-auto">
                {vendorOptions.map((v) => {
                  const isChecked = selectedVendors.includes(v.id);
                  return (
                    <div
                      key={v.id}
                      onClick={() => toggleVendor(v.id)}
                      className={`p-3 rounded-xl border cursor-pointer transition text-xs ${
                        isChecked
                          ? 'bg-accent-violet/10 border-accent-violet/40 text-text-primary'
                          : 'bg-card-elevated border-border text-text-muted hover:text-text-primary'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold">{v.name}</span>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          className="accent-accent-violet"
                        />
                      </div>
                      <span className="text-[10px] text-text-faint font-mono block mt-1">{v.id}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 4: SOLANA AUTHORIZATION REVIEW */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="bg-card-elevated p-4 rounded-xl border border-border space-y-3 text-xs font-mono">
                <div className="flex items-center space-x-2 text-solana font-bold">
                  <ShieldCheck size={16} />
                  <span>Solana Subscriptions & Allowances Review</span>
                </div>
                <div className="space-y-1.5 text-text-secondary">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Agent Name:</span>
                    <span className="font-bold text-text-primary">{name || 'autonomous-agent'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Allowed Per Call:</span>
                    <span className="text-text-primary">${maxPerCall} USDC</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Daily Cap:</span>
                    <span className="text-text-primary">${dailyBudget} USDC</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Authorized Vendors:</span>
                    <span className="text-accent-violet font-semibold">{selectedVendors.length} providers</span>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-accent-violet/10 border border-accent-violet/25 rounded-xl text-xs text-text-secondary space-y-1">
                <span className="font-bold text-accent-violet block">Self-Custodial Guarantee:</span>
                <p className="text-[11px] leading-relaxed">
                  AutoStream does not hold your keys. Signing will create a Program Derived Address (PDA) with
                  bounded spending rights according to the official Solana Subscriptions program.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Wizard Footer Controls */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-card-elevated">
          {step > 1 ? (
            <button
              onClick={() => setStep(step - 1)}
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary px-3 py-2 rounded-xl transition"
            >
              <ArrowLeft size={14} /> Back
            </button>
          ) : (
            <div></div>
          )}

          {step < 4 ? (
            <button
              onClick={() => setStep(step + 1)}
              className="flex items-center gap-1.5 bg-accent-violet hover:bg-accent-violet/90 text-white font-semibold text-xs px-4 py-2 rounded-xl transition"
            >
              Next <ArrowRight size={14} />
            </button>
          ) : (
            <button
              onClick={handleSignAndCreate}
              disabled={isSigning || signed}
              className="flex items-center gap-2 bg-gradient-to-r from-accent-violet via-solana-purple to-solana hover:opacity-95 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-md transition disabled:opacity-50"
            >
              {isSigning ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Awaiting Wallet Signature...</span>
                </>
              ) : signed ? (
                <>
                  <CheckCircle2 size={16} />
                  <span>Authorized On-Chain!</span>
                </>
              ) : (
                <>
                  <Wallet size={16} />
                  <span>Sign & Initialize Agent</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
