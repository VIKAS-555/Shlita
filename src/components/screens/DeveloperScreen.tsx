import React, { useState } from 'react';
import {
  Key,
  Copy,
  Check,
  Eye,
  EyeOff,
  Terminal,
  Send,
} from 'lucide-react';

export const DeveloperScreen: React.FC = () => {
  const [activeLang, setActiveLang] = useState<'curl' | 'nodejs' | 'python' | 'solana'>('nodejs');
  const [showKey, setShowKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  // Sandbox simulation state
  const [sandboxAgent, setSandboxAgent] = useState('agent-researcher-01');
  const [sandboxVendor, setSandboxVendor] = useState('api.helius.xyz');
  const [sandboxAmount, setSandboxAmount] = useState('0.02');
  const [sandboxResponse, setSandboxResponse] = useState<any>(null);
  const [isRunningSandbox, setIsRunningSandbox] = useState(false);

  const apiKey = 'shlt_live_79f939b4e18ac89a42ff9041280bce42';

  const snippets = {
    curl: `curl -X POST https://api.shlita.finance/v1/proxy \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentId": "agent-researcher-01",
    "vendor": "api.helius.xyz",
    "estimatedCostMicroUsdc": "20000",
    "path": "/v0/addresses/USDC/balances"
  }'`,
    nodejs: `import { ShlitaClient } from '@shlita/sdk';

const client = new ShlitaClient({
  apiKey: process.env.SHLITA_API_KEY,
  network: 'mainnet-beta',
});

// Outbound paid API call via Shlita policy perimeter
const response = await client.proxy({
  agentId: 'agent-researcher-01',
  vendor: 'api.helius.xyz',
  estimatedCostMicroUsdc: 20000n, // $0.02 USDC
  method: 'POST',
  path: '/v0/token-metadata',
  body: { mints: ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'] },
});

console.log('Approved & Settled:', response.data);`,
    python: `from shlita import ShlitaClient

client = ShlitaClient(
    api_key="shlt_live_...",
    network="mainnet-beta"
)

# Intercept and evaluate spending before network dispatch
res = client.proxy(
    agent_id="agent-researcher-01",
    vendor="api.tavily.com",
    estimated_cost_micro_usdc=15000,
    path="/search",
    json={"query": "Solana Subscriptions 2026"}
)

print(f"Settled: {res.is_allowed}, Spend: {res.current_spend_usdc}")`,
    solana: `import { PublicKey, Transaction } from '@solana/web3.js';
import { deriveSubscriptionAuthorityPda } from '@shlita/solana';

// Derive deterministic Subscriptions Authority PDA
const [authorityPda, bump] = deriveSubscriptionAuthorityPda(
  agentWallet.publicKey,
  merchantWallet.publicKey,
  PROGRAM_ID
);

console.log('Solana Subscriptions Authority PDA:', authorityPda.toBase58());`,
  };

  const copyToClipboard = (text: string, isKey = false) => {
    navigator.clipboard.writeText(text);
    if (isKey) {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 1500);
    } else {
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 1500);
    }
  };

  const handleRunSandbox = () => {
    setIsRunningSandbox(true);
    setTimeout(() => {
      setIsRunningSandbox(false);
      const cost = Number(sandboxAmount);
      if (sandboxVendor === 'evil-drainer-api.org') {
        setSandboxResponse({
          status: 403,
          allowed: false,
          error: 'POLICY_VIOLATION',
          reason: 'UNAPPROVED_VENDOR',
          message: 'Target vendor evil-drainer-api.org is not in agent whitelist.',
          timestamp: new Date().toISOString(),
        });
      } else if (cost > 0.05) {
        setSandboxResponse({
          status: 403,
          allowed: false,
          error: 'POLICY_VIOLATION',
          reason: 'PER_CALL_LIMIT_EXCEEDED',
          message: `Request cost ($${cost.toFixed(2)}) exceeds per-call limit ($0.05 USDC).`,
          timestamp: new Date().toISOString(),
        });
      } else {
        setSandboxResponse({
          status: 200,
          allowed: true,
          vendor: sandboxVendor,
          settlement: {
            costMicroUsdc: Math.round(cost * 1_000_000).toString(),
            currency: 'USDC',
            status: 'SETTLED',
            txSignature: `5sol_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          },
          upstream: {
            network: 'solana-mainnet-beta',
            slot: 318492048,
            result: 'Query successfully dispatched and settled.',
          },
        });
      }
    }, 500);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h2 className="text-xl font-bold text-text-primary tracking-tight">Developer Center & API SDK</h2>
          <p className="text-xs text-text-muted mt-1">
            Integrate the Shlita financial gateway into your autonomous agent workflows and MCP servers.
          </p>
        </div>
        <div className="flex items-center space-x-2 text-xs font-mono bg-card border border-border px-3 py-1.5 rounded-xl shadow-sm">
          <span className="w-2 h-2 rounded-full bg-solana animate-pulse"></span>
          <span className="text-text-secondary">API Environment: Production</span>
        </div>
      </div>

      {/* API Key Box */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-text-primary text-sm">Active Secret API Key</h3>
            <p className="text-xs text-text-muted">Used by your agent runtime or proxy gateway to authenticate.</p>
          </div>
          <button
            onClick={() => copyToClipboard(apiKey, true)}
            className="flex items-center gap-1.5 bg-card-elevated hover:bg-border text-text-primary border border-border text-xs px-3.5 py-1.5 rounded-xl transition shadow-sm"
          >
            {copiedKey ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
            <span>{copiedKey ? 'Copied!' : 'Copy Key'}</span>
          </button>
        </div>

        <div className="flex items-center justify-between bg-card-elevated p-3 rounded-xl border border-border text-xs font-mono">
          <span className="text-text-secondary tracking-wider">
            {showKey ? apiKey : 'shlt_live_••••••••••••••••••••••••••••••••'}
          </span>
          <button
            onClick={() => setShowKey(!showKey)}
            className="text-text-muted hover:text-text-primary transition"
          >
            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      {/* Code Sandbox & Docs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Code Snippets */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center space-x-2">
                <Terminal size={16} className="text-accent-violet" />
                <h4 className="font-bold text-text-primary text-sm">Agent Gateway Request</h4>
              </div>
              <button
                onClick={() => copyToClipboard(snippets[activeLang])}
                className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1 font-mono transition"
              >
                {copiedSnippet ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                <span>{copiedSnippet ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            {/* Language Tabs */}
            <div className="flex space-x-2 my-4">
              {(['nodejs', 'python', 'curl', 'solana'] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setActiveLang(lang)}
                  className={`px-3 py-1 rounded-lg text-xs font-mono uppercase transition ${
                    activeLang === lang
                      ? 'bg-accent-violet text-white font-bold shadow-sm'
                      : 'bg-card-elevated text-text-muted hover:text-text-primary'
                  }`}
                >
                  {lang}
                </button>
              ))}
            </div>

            {/* Code Block */}
            <pre className="bg-[#0B0D14] text-[#E6EDF3] p-4 rounded-xl border border-border text-[11px] font-mono overflow-x-auto leading-relaxed">
              <code>{snippets[activeLang]}</code>
            </pre>
          </div>

          <p className="text-[11px] text-text-muted mt-4 font-mono">
            Requires Node.js 18+ or Python 3.9+. Supports TypeScript native ESM types.
          </p>
        </div>

        {/* Right: Live Interactive Sandbox Tester */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
          <div className="pb-3 border-b border-border">
            <h4 className="font-bold text-text-primary text-sm">Interactive Policy Gateway Sandbox</h4>
            <p className="text-xs text-text-muted">Trigger live simulated tool requests to test enforcement rules</p>
          </div>

          <div className="space-y-3 text-xs font-mono">
            <div>
              <label className="text-text-muted block mb-1">CALLING AGENT</label>
              <select
                value={sandboxAgent}
                onChange={(e) => setSandboxAgent(e.target.value)}
                className="w-full bg-card-elevated border border-border rounded-xl px-3 py-2 text-text-primary outline-none"
              >
                <option value="agent-researcher-01">research-agent-01 (Cap: $0.05 / call)</option>
                <option value="agent-dev-prod">dev-agent-prod (Cap: $20.00 / call)</option>
              </select>
            </div>

            <div>
              <label className="text-text-muted block mb-1">TARGET VENDOR</label>
              <select
                value={sandboxVendor}
                onChange={(e) => setSandboxVendor(e.target.value)}
                className="w-full bg-card-elevated border border-border rounded-xl px-3 py-2 text-text-primary outline-none"
              >
                <option value="api.helius.xyz">api.helius.xyz (Whitelisted)</option>
                <option value="api.tavily.com">api.tavily.com (Whitelisted)</option>
                <option value="evil-drainer-api.org">evil-drainer-api.org (Unapproved)</option>
              </select>
            </div>

            <div>
              <label className="text-text-muted block mb-1">ESTIMATED COST ($ USDC)</label>
              <input
                type="number"
                step="0.01"
                value={sandboxAmount}
                onChange={(e) => setSandboxAmount(e.target.value)}
                className="w-full bg-card-elevated border border-border rounded-xl px-3 py-2 text-text-primary outline-none"
              />
            </div>

            <button
              onClick={handleRunSandbox}
              disabled={isRunningSandbox}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-accent-violet to-solana-purple hover:opacity-95 text-white font-bold text-xs py-2.5 rounded-xl transition cursor-pointer shadow-sm"
            >
              <Send size={14} />
              <span>{isRunningSandbox ? 'Evaluating Policy...' : 'Send Gateway Request'}</span>
            </button>
          </div>

          {/* Sandbox Response Terminal */}
          {sandboxResponse && (
            <div className="space-y-1">
              <span className="text-[10px] font-mono text-text-muted uppercase">Perimeter Response:</span>
              <pre
                className={`p-3 rounded-xl border text-[11px] font-mono overflow-x-auto ${
                  sandboxResponse.status === 200
                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-400'
                    : 'bg-red-500/10 border-red-500/25 text-red-500'
                }`}
              >
                <code>{JSON.stringify(sandboxResponse, null, 2)}</code>
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
