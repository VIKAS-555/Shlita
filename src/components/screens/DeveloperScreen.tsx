import React, { useState } from 'react';
import {
  Key,
  Copy,
  Check,
  Eye,
  EyeOff,
  Terminal,
  Send,
  Cpu,
} from 'lucide-react';
import { Agent } from '../../types/dashboard.js';
import { SolanaPdaInspector } from '../developer/SolanaPdaInspector.js';

interface DeveloperScreenProps {
  agents?: Agent[];
  onLogTelemetry?: (event: any) => void;
}

export const DeveloperScreen: React.FC<DeveloperScreenProps> = ({ agents = [], onLogTelemetry }) => {
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

  const apiKey = 'shlt_example_not_a_secret';

  const snippets = {
    curl: `curl -X POST "$SHLITA_GATEWAY_URL/v1/proxy" \\
  -H "x-shlita-api-key: $SHLITA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentId": "agent-researcher-01",
    "vendor": "api.helius.xyz",
    "path": "/v0/token-metadata",
    "idempotencyKey": "operation-unique-id",
    "simulate": true
  }'`,
    nodejs: `import { ShlitaAgentClient } from 'shlita-sdk';

const shlita = new ShlitaAgentClient({
  apiKey: process.env.SHLITA_API_KEY,
  baseUrl: process.env.SHLITA_GATEWAY_URL,
});

const result = await shlita.proxy({
  agentId: 'agent-researcher-01',
  vendor: 'api.helius.xyz',
  method: 'POST',
  path: '/v0/token-metadata',
  body: { mints: ['example-mint'] },
  idempotencyKey: 'operation-unique-id',
});

console.log(result.outcome);`,
    python: `# A Python package is not part of this repository.
# Use the Node.js package shlita-sdk, installed from the local archive.
# Do not send an agent key from a browser.`,
    solana: `// Chain settlement is an operator action on the gateway.
// The agent SDK does not hold a payer key, and mainnet is off unless
// the gateway is explicitly configured for it.
// A committed proxy response has fundsMoved: false until a confirmed settlement exists.`,
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
        const resp = {
          status: 403,
          allowed: false,
          error: 'POLICY_VIOLATION',
          reason: 'UNAPPROVED_VENDOR',
          message: 'Target vendor evil-drainer-api.org is not in agent whitelist.',
          timestamp: new Date().toISOString(),
        };
        setSandboxResponse(resp);
        if (onLogTelemetry) {
          onLogTelemetry({
            id: `tel-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            type: 'BLOCKED',
            statusCode: 403,
            agent: sandboxAgent,
            vendor: sandboxVendor,
            amountUsdc: cost,
            latencyMs: 0.08,
            details: resp,
          });
        }
      } else if (cost > 0.05 && sandboxAgent === 'agent-researcher-01') {
        const resp = {
          status: 403,
          allowed: false,
          error: 'POLICY_VIOLATION',
          reason: 'PER_CALL_LIMIT_EXCEEDED',
          message: `Request cost ($${cost.toFixed(2)}) exceeds per-call limit ($0.05 USDC).`,
          timestamp: new Date().toISOString(),
        };
        setSandboxResponse(resp);
        if (onLogTelemetry) {
          onLogTelemetry({
            id: `tel-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            type: 'BLOCKED',
            statusCode: 403,
            agent: sandboxAgent,
            vendor: sandboxVendor,
            amountUsdc: cost,
            latencyMs: 0.06,
            details: resp,
          });
        }
      } else {
        const resp = {
          status: 200,
          allowed: true,
          mode: 'simulated',
          lifecycleState: 'VENDOR_SUCCEEDED',
          vendor: sandboxVendor,
          settlement: {
            costMicroUsdc: Math.round(cost * 1_000_000).toString(),
            currency: 'USDC',
            status: 'SETTLEMENT_PENDING',
            note: 'Simulated sandbox authorization. Never marked SETTLED without independently confirmed Solana transaction.',
          },
          upstream: {
            network: 'solana-devnet',
            slot: 318492048,
            result: 'Query successfully dispatched and validated under Shlita policy perimeter.',
          },
        };
        setSandboxResponse(resp);
        if (onLogTelemetry) {
          onLogTelemetry({
            id: `tel-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            type: 'APPROVED',
            statusCode: 200,
            agent: sandboxAgent,
            vendor: sandboxVendor,
            amountUsdc: cost,
            latencyMs: 0.14,
            details: resp,
          });
        }
      }
    }, 500);
  };

  return (
    <div className="space-y-8">
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
            className="flex items-center gap-1.5 bg-card-elevated hover:bg-border text-text-primary border border-border text-xs px-3.5 py-1.5 rounded-xl transition shadow-sm cursor-pointer"
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
            className="text-text-muted hover:text-text-primary p-1 rounded transition cursor-pointer"
          >
            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      {/* 2-Column: SDK Usage Snippets & Sandbox */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Code Snippets */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center space-x-2">
                <Terminal size={16} className="text-accent-violet" />
                <h4 className="font-bold text-text-primary text-sm">SDK Integration Snippets</h4>
              </div>
              <button
                onClick={() => copyToClipboard(snippets[activeLang])}
                className="flex items-center space-x-1.5 text-xs text-text-muted hover:text-text-primary cursor-pointer"
              >
                {copiedSnippet ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                <span>{copiedSnippet ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            {/* Language Tabs */}
            <div className="flex space-x-2 my-4">
              {(['nodejs', 'python', 'curl', 'solana'] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setActiveLang(lang)}
                  className={`px-3 py-1 rounded-lg text-xs font-mono uppercase transition cursor-pointer ${
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
            Node.js 22 or newer. Install the local shlita-sdk archive. There is no Python package.
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
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-accent-violet to-solana-purple hover:opacity-95 text-white font-bold text-xs py-2.5 rounded-xl transition cursor-pointer shadow-sm disabled:opacity-50"
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

      {/* Web3 Solana Cryptographic PDA Derivation Tool */}
      <div className="space-y-3">
        <div>
          <h3 className="text-base font-bold text-text-primary tracking-tight">
            Solana Subscriptions Cryptographic PDA Derivation Tool
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            Direct Web3 inspector computing non-custodial Program Derived Addresses (<code className="font-mono text-solana">findProgramAddressSync</code>) with <code className="font-mono text-text-primary">@solana/web3.js</code>.
          </p>
        </div>
        <SolanaPdaInspector agents={agents} />
      </div>
    </div>
  );
};
