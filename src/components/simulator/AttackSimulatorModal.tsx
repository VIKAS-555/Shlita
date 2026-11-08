import React, { useState, useEffect } from 'react';
import {
  X,
  Play,
  ShieldCheck,
  ShieldAlert,
  Zap,
  RotateCcw,
  Bot,
  Terminal,
  Activity,
  ArrowRight,
  Flame,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
} from 'lucide-react';
import { Agent, Transaction } from '../../types/dashboard.js';

export interface SimulatorExecutionResult {
  scenarioId: string;
  agentId: string;
  vendor: string;
  amountUsdc: number;
  status: 'CONFIRMED' | 'BLOCKED_BY_POLICY' | 'CIRCUIT_TRIPPED';
  reason?: string;
  signature?: string;
  latencyMs: number;
  burstCount?: number;
}

interface AttackSimulatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  agents: Agent[];
  onApplyExecution: (result: SimulatorExecutionResult) => void;
  onResetCircuitBreaker: (agentId: string) => void;
}

type ScenarioType = 'NORMAL_RPC' | 'PROMPT_INJECTION' | 'CAP_VIOLATION' | 'LOOP_ATTACK';

export const AttackSimulatorModal: React.FC<AttackSimulatorModalProps> = ({
  isOpen,
  onClose,
  agents,
  onApplyExecution,
  onResetCircuitBreaker,
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState<string>(agents[0]?.id || 'agent-research-01');
  const [activeTab, setActiveTab] = useState<'PRESETS' | 'CUSTOM'>('PRESETS');
  const [activeScenario, setActiveScenario] = useState<ScenarioType>('NORMAL_RPC');

  // Custom sandbox state
  const [customVendor, setCustomVendor] = useState('api.helius.xyz');
  const [customAmount, setCustomAmount] = useState('0.02');
  const [customPath, setCustomPath] = useState('/v0/addresses/USDC/balances');

  // Execution simulation state
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [burstCounter, setBurstCounter] = useState<number>(0);
  const [executionResult, setExecutionResult] = useState<SimulatorExecutionResult | null>(null);

  const currentAgent = agents.find((a) => a.id === selectedAgentId) || agents[0];

  useEffect(() => {
    if (!isOpen) {
      setCurrentStep(0);
      setExecutionResult(null);
      setBurstCounter(0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const runScenario = async () => {
    setIsExecuting(true);
    setCurrentStep(1); // Stage 1: Dispatched
    setExecutionResult(null);

    // Stage 1 -> 2: Policy Inspection
    await new Promise((r) => setTimeout(r, 450));
    setCurrentStep(2);

    if (activeScenario === 'NORMAL_RPC') {
      await new Promise((r) => setTimeout(r, 400));
      setCurrentStep(3); // Stage 3: Solana PDA Settlement
      await new Promise((r) => setTimeout(r, 350));
      setCurrentStep(4); // Stage 4: Completed

      const result: SimulatorExecutionResult = {
        scenarioId: 'NORMAL_RPC',
        agentId: currentAgent.id,
        vendor: 'api.helius.xyz',
        amountUsdc: 0.02,
        status: 'CONFIRMED',
        signature: `5sol_auth_${Math.random().toString(36).substring(2, 9)}`,
        latencyMs: 42,
      };
      setExecutionResult(result);
      onApplyExecution(result);
      setIsExecuting(false);
    } else if (activeScenario === 'PROMPT_INJECTION') {
      await new Promise((r) => setTimeout(r, 450));
      setCurrentStep(3);
      await new Promise((r) => setTimeout(r, 300));
      setCurrentStep(4);

      const result: SimulatorExecutionResult = {
        scenarioId: 'PROMPT_INJECTION',
        agentId: currentAgent.id,
        vendor: 'evil-drainer-api.org',
        amountUsdc: 15.00,
        status: 'BLOCKED_BY_POLICY',
        reason: 'UNAPPROVED_VENDOR: Vendor "evil-drainer-api.org" is not on approved whitelist [api.helius.xyz, api.tavily.com]. Intercepted by Shlita Firewall.',
        latencyMs: 14,
      };
      setExecutionResult(result);
      onApplyExecution(result);
      setIsExecuting(false);
    } else if (activeScenario === 'CAP_VIOLATION') {
      await new Promise((r) => setTimeout(r, 450));
      setCurrentStep(3);
      await new Promise((r) => setTimeout(r, 300));
      setCurrentStep(4);

      const result: SimulatorExecutionResult = {
        scenarioId: 'CAP_VIOLATION',
        agentId: currentAgent.id,
        vendor: 'api.anthropic.com',
        amountUsdc: 75.00,
        status: 'BLOCKED_BY_POLICY',
        reason: `PER_CALL_LIMIT_EXCEEDED: Request cost ($75.00 USDC) exceeds per-call limit ($${currentAgent.maxPerCallUsdc.toFixed(2)} USDC). Zero funds moved.`,
        latencyMs: 18,
      };
      setExecutionResult(result);
      onApplyExecution(result);
      setIsExecuting(false);
    } else if (activeScenario === 'LOOP_ATTACK') {
      // Rapid burst simulation (firing 8 calls in quick succession)
      for (let i = 1; i <= 8; i++) {
        setBurstCounter(i);
        await new Promise((r) => setTimeout(r, 140));
      }
      setCurrentStep(3);
      await new Promise((r) => setTimeout(r, 300));
      setCurrentStep(4);

      const result: SimulatorExecutionResult = {
        scenarioId: 'LOOP_ATTACK',
        agentId: currentAgent.id,
        vendor: 'api.helius.xyz',
        amountUsdc: 0.05,
        status: 'CIRCUIT_TRIPPED',
        burstCount: 8,
        reason: 'RATE_ANOMALY_LOOP_DETECTED: Call frequency (8 calls / 1.2s) crossed circuit breaker threshold (>6 calls/min). Agent automatically suspended.',
        latencyMs: 12,
      };
      setExecutionResult(result);
      onApplyExecution(result);
      setIsExecuting(false);
    }
  };

  const handleCustomDispatch = async () => {
    setIsExecuting(true);
    setCurrentStep(1);
    setExecutionResult(null);

    await new Promise((r) => setTimeout(r, 400));
    setCurrentStep(2);
    await new Promise((r) => setTimeout(r, 400));
    setCurrentStep(3);
    await new Promise((r) => setTimeout(r, 300));
    setCurrentStep(4);

    const costNum = parseFloat(customAmount) || 0.01;
    const isAllowedVendor = currentAgent.allowedVendors.some(
      (v) => v === customVendor || customVendor.endsWith(`.${v}`)
    );
    const isOverCap = costNum > currentAgent.maxPerCallUsdc;

    let res: SimulatorExecutionResult;
    if (!isAllowedVendor) {
      res = {
        scenarioId: 'CUSTOM',
        agentId: currentAgent.id,
        vendor: customVendor,
        amountUsdc: costNum,
        status: 'BLOCKED_BY_POLICY',
        reason: `UNAPPROVED_VENDOR: "${customVendor}" not in agent whitelist [${currentAgent.allowedVendors.join(', ')}].`,
        latencyMs: 16,
      };
    } else if (isOverCap) {
      res = {
        scenarioId: 'CUSTOM',
        agentId: currentAgent.id,
        vendor: customVendor,
        amountUsdc: costNum,
        status: 'BLOCKED_BY_POLICY',
        reason: `PER_CALL_LIMIT_EXCEEDED: Requested $${costNum.toFixed(2)} exceeds cap $${currentAgent.maxPerCallUsdc.toFixed(2)}.`,
        latencyMs: 18,
      };
    } else {
      res = {
        scenarioId: 'CUSTOM',
        agentId: currentAgent.id,
        vendor: customVendor,
        amountUsdc: costNum,
        status: 'CONFIRMED',
        signature: `5sol_custom_${Math.random().toString(36).substring(2, 8)}`,
        latencyMs: 38,
      };
    }

    setExecutionResult(res);
    onApplyExecution(res);
    setIsExecuting(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-card border border-border w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden my-8">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card-elevated">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-accent-violet/10 text-accent-violet border border-accent-violet/20">
              <Zap size={18} />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-sm text-text-primary tracking-tight">
                  Interactive Attack Simulator & Circuit Breaker Playground
                </h3>
                <span className="text-[10px] bg-solana/15 text-solana px-2 py-0.5 rounded-full font-mono font-bold">
                  LIVE TESTBED
                </span>
              </div>
              <p className="text-[11px] text-text-muted mt-0.5">
                Simulate real-world agent attacks, prompt injections, and loop circuit breakers in real time.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary p-1.5 rounded-lg hover:bg-border transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Agent Selector & Mode Tabs */}
        <div className="px-6 py-3 border-b border-border bg-card flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-2">
            <span className="text-text-muted font-mono uppercase text-[11px]">Target Agent:</span>
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="bg-card-elevated border border-border rounded-xl px-3 py-1.5 text-text-primary font-mono text-xs outline-none cursor-pointer"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id} className="bg-card text-text-primary">
                  {a.avatar} {a.name} ({a.status}) — ${a.maxPerCallUsdc}/call max
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-1.5 bg-card-elevated p-1 rounded-xl border border-border">
            <button
              onClick={() => setActiveTab('PRESETS')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                activeTab === 'PRESETS'
                  ? 'bg-accent-violet text-white shadow-sm'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              Attack Presets
            </button>
            <button
              onClick={() => setActiveTab('CUSTOM')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                activeTab === 'CUSTOM'
                  ? 'bg-accent-violet text-white shadow-sm'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              Custom Sandbox
            </button>
          </div>
        </div>

        {/* Main Body */}
        <div className="p-6 space-y-6">
          {activeTab === 'PRESETS' ? (
            /* Presets Grid */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Preset 1 */}
              <div
                onClick={() => !isExecuting && setActiveScenario('NORMAL_RPC')}
                className={`p-4 rounded-xl border transition cursor-pointer flex flex-col justify-between ${
                  activeScenario === 'NORMAL_RPC'
                    ? 'bg-accent-violet/5 border-accent-violet shadow-sm'
                    : 'bg-card-elevated border-border hover:border-border-hover'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                      <CheckCircle2 size={14} className="text-emerald-500" />
                      Authorized Tool Micro-Payment
                    </span>
                    <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full font-bold">
                      $0.02 USDC
                    </span>
                  </div>
                  <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
                    Legitimate tool call to approved Helius RPC. Passes under the \$0.05 cap and clears the whitelist.
                  </p>
                </div>
                <div className="mt-3 text-[10px] font-mono text-text-faint">
                  Destination: <span className="text-text-secondary">api.helius.xyz</span>
                </div>
              </div>

              {/* Preset 2 */}
              <div
                onClick={() => !isExecuting && setActiveScenario('PROMPT_INJECTION')}
                className={`p-4 rounded-xl border transition cursor-pointer flex flex-col justify-between ${
                  activeScenario === 'PROMPT_INJECTION'
                    ? 'bg-red-500/5 border-red-500 shadow-sm'
                    : 'bg-card-elevated border-border hover:border-border-hover'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                      <ShieldAlert size={14} className="text-red-500" />
                      Prompt Injection Drainer
                    </span>
                    <span className="text-[10px] font-mono text-red-500 bg-red-500/10 px-2 py-0.5 rounded-full font-bold">
                      $15.00 USDC
                    </span>
                  </div>
                  <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
                    Malicious prompt tricks agent into transferring treasury funds to an unapproved drainer domain.
                  </p>
                </div>
                <div className="mt-3 text-[10px] font-mono text-text-faint">
                  Destination: <span className="text-red-400">evil-drainer-api.org</span>
                </div>
              </div>

              {/* Preset 3 */}
              <div
                onClick={() => !isExecuting && setActiveScenario('CAP_VIOLATION')}
                className={`p-4 rounded-xl border transition cursor-pointer flex flex-col justify-between ${
                  activeScenario === 'CAP_VIOLATION'
                    ? 'bg-amber-500/5 border-amber-500 shadow-sm'
                    : 'bg-card-elevated border-border hover:border-border-hover'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                      <AlertTriangle size={14} className="text-amber-500" />
                      Per-Call Cap Violation
                    </span>
                    <span className="text-[10px] font-mono text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full font-bold">
                      $75.00 USDC
                    </span>
                  </div>
                  <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
                    Agent attempts an expensive bulk inference query exceeding its \$10.00 per-call hard cap.
                  </p>
                </div>
                <div className="mt-3 text-[10px] font-mono text-text-faint">
                  Destination: <span className="text-text-secondary">api.anthropic.com</span>
                </div>
              </div>

              {/* Preset 4 */}
              <div
                onClick={() => !isExecuting && setActiveScenario('LOOP_ATTACK')}
                className={`p-4 rounded-xl border transition cursor-pointer flex flex-col justify-between ${
                  activeScenario === 'LOOP_ATTACK'
                    ? 'bg-purple-500/5 border-solana shadow-sm'
                    : 'bg-card-elevated border-border hover:border-border-hover'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                      <Flame size={14} className="text-solana" />
                      Infinite Recursive Loop Surge
                    </span>
                    <span className="text-[10px] font-mono text-solana bg-solana/10 px-2 py-0.5 rounded-full font-bold">
                      Burst 8 Calls
                    </span>
                  </div>
                  <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
                    Agent gets trapped in a recursive hallucination loop. Circuit breaker detects anomaly and trips.
                  </p>
                </div>
                <div className="mt-3 text-[10px] font-mono text-text-faint">
                  Trigger: <span className="text-solana">&gt;6 calls/minute threshold</span>
                </div>
              </div>
            </div>
          ) : (
            /* Custom Sandbox Form */
            <div className="bg-card-elevated p-4 rounded-xl border border-border space-y-3 text-xs font-mono">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-text-muted block text-[11px] mb-1">TARGET VENDOR ENDPOINT</label>
                  <input
                    type="text"
                    value={customVendor}
                    onChange={(e) => setCustomVendor(e.target.value)}
                    placeholder="e.g. api.helius.xyz"
                    className="w-full bg-card border border-border focus:border-accent-violet rounded-xl px-3 py-2 text-text-primary outline-none"
                  />
                </div>
                <div>
                  <label className="text-text-muted block text-[11px] mb-1">ESTIMATED COST (USDC)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    className="w-full bg-card border border-border focus:border-accent-violet rounded-xl px-3 py-2 text-text-primary outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-text-muted block text-[11px] mb-1">HTTP PATH</label>
                <input
                  type="text"
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                  className="w-full bg-card border border-border focus:border-accent-violet rounded-xl px-3 py-2 text-text-primary outline-none"
                />
              </div>
            </div>
          )}

          {/* Stepper Pipeline Visualization */}
          <div className="bg-card-elevated border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-text-muted uppercase text-[10px] tracking-wider">
                Execution Pipeline Telemetry
              </span>
              {isExecuting && (
                <span className="text-accent-violet flex items-center gap-1.5 text-[11px] animate-pulse">
                  <Activity size={13} />
                  Evaluating in real-time...
                </span>
              )}
            </div>

            <div className="grid grid-cols-4 gap-2 text-center text-xs font-mono">
              {/* Step 1 */}
              <div
                className={`p-2.5 rounded-lg border transition ${
                  currentStep >= 1
                    ? 'bg-accent-violet/10 border-accent-violet text-accent-violet font-bold'
                    : 'bg-card border-border text-text-muted'
                }`}
              >
                <span className="text-[10px] block opacity-75">STAGE 1</span>
                <span>Agent Dispatch</span>
              </div>

              {/* Step 2 */}
              <div
                className={`p-2.5 rounded-lg border transition ${
                  currentStep >= 2
                    ? 'bg-cyan-500/10 border-cyan-500 text-cyan-600 dark:text-cyan-400 font-bold'
                    : 'bg-card border-border text-text-muted'
                }`}
              >
                <span className="text-[10px] block opacity-75">STAGE 2</span>
                <span>Policy Evaluation</span>
              </div>

              {/* Step 3 */}
              <div
                className={`p-2.5 rounded-lg border transition ${
                  currentStep >= 3
                    ? executionResult?.status === 'CONFIRMED'
                      ? 'bg-emerald-500/10 border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold'
                      : 'bg-red-500/10 border-red-500 text-red-500 font-bold'
                    : 'bg-card border-border text-text-muted'
                }`}
              >
                <span className="text-[10px] block opacity-75">STAGE 3</span>
                <span>Solana PDA Seam</span>
              </div>

              {/* Step 4 */}
              <div
                className={`p-2.5 rounded-lg border transition ${
                  currentStep >= 4
                    ? executionResult?.status === 'CONFIRMED'
                      ? 'bg-emerald-500/15 border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold'
                      : 'bg-red-500/15 border-red-500 text-red-500 font-bold'
                    : 'bg-card border-border text-text-muted'
                }`}
              >
                <span className="text-[10px] block opacity-75">STAGE 4</span>
                <span>{executionResult ? executionResult.status : 'Outcome'}</span>
              </div>
            </div>

            {/* Loop Attack Burst Counter Bar */}
            {activeScenario === 'LOOP_ATTACK' && isExecuting && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs font-mono space-y-1.5 animate-in fade-in">
                <div className="flex items-center justify-between text-red-500 font-bold">
                  <span>⚡ Rapid Burst Detected: {burstCounter} / 8 Calls</span>
                  <span className="animate-ping font-extrabold text-sm">SURGING</span>
                </div>
                <div className="w-full bg-border h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-red-500 h-full transition-all duration-150"
                    style={{ width: `${(burstCounter / 8) * 100}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>

          {/* Result Output Terminal */}
          {executionResult && (
            <div className="bg-[#0B0D14] text-[#E6EDF3] p-4 rounded-xl border border-border text-xs font-mono space-y-2 animate-in fade-in duration-200">
              <div className="flex items-center justify-between pb-2 border-b border-border/40 text-[11px]">
                <div className="flex items-center space-x-2">
                  <Terminal size={14} className="text-solana" />
                  <span className="font-bold">SHLITA GATEWAY PROXY LOG</span>
                </div>
                <span className="text-text-faint">{executionResult.latencyMs}ms latency</span>
              </div>

              <div className="space-y-1 pt-1 leading-relaxed">
                <div>
                  HTTP STATUS:{' '}
                  <span
                    className={
                      executionResult.status === 'CONFIRMED'
                        ? 'text-emerald-400 font-bold'
                        : 'text-red-400 font-bold'
                    }
                  >
                    {executionResult.status === 'CONFIRMED' ? '200 OK (AUTHORIZED)' : '403 FORBIDDEN (INTERCEPTED)'}
                  </span>
                </div>
                <div>
                  TARGET ENDPOINT: <span className="text-cyan-300">{executionResult.vendor}</span>
                </div>
                <div>
                  VALUE:{' '}
                  <span className="text-white font-bold">${executionResult.amountUsdc.toFixed(2)} USDC</span>
                </div>
                {executionResult.signature && (
                  <div>
                    SOLANA PDA SIGNATURE:{' '}
                    <span className="text-solana">{executionResult.signature}</span>
                  </div>
                )}
                {executionResult.reason && (
                  <div className="p-2.5 bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg text-[11px] mt-2">
                    {executionResult.reason}
                  </div>
                )}
              </div>

              {executionResult.status === 'CIRCUIT_TRIPPED' && (
                <div className="pt-2 flex items-center justify-between">
                  <span className="text-amber-400 text-[11px]">
                    ⚠️ Agent has been transitioned to CIRCUIT_TRIPPED status.
                  </span>
                  <button
                    onClick={() => {
                      onResetCircuitBreaker(currentAgent.id);
                      setExecutionResult(null);
                      setCurrentStep(0);
                    }}
                    className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition"
                  >
                    <RotateCcw size={12} />
                    Reset Circuit Breaker Now
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Action Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-card-elevated">
          <div className="text-[11px] font-mono text-text-muted flex items-center gap-1.5">
            <Bot size={14} className="text-accent-violet" />
            <span>
              Target: <b className="text-text-primary">{currentAgent.name}</b> (${currentAgent.spentThisMonthUsdc.toFixed(2)} spent)
            </span>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={onClose}
              className="text-xs px-4 py-2 rounded-xl text-text-muted hover:text-text-primary hover:bg-border transition"
            >
              Close
            </button>
            <button
              disabled={isExecuting}
              onClick={activeTab === 'PRESETS' ? runScenario : handleCustomDispatch}
              className="flex items-center gap-2 bg-gradient-to-r from-accent-violet via-solana-purple to-solana hover:opacity-95 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-md transition disabled:opacity-50 cursor-pointer"
            >
              {isExecuting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Executing Pipeline...</span>
                </>
              ) : (
                <>
                  <Play size={14} fill="currentColor" />
                  <span>Run Live Simulation</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
