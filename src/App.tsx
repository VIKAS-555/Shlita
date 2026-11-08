import React, { useState, useEffect } from 'react';
import { Sidebar, ScreenId } from './components/layout/Sidebar.js';
import { TopNav } from './components/layout/TopNav.js';
import { OverviewScreen } from './components/screens/OverviewScreen.js';
import { AgentsScreen } from './components/screens/AgentsScreen.js';
import { PoliciesScreen } from './components/screens/PoliciesScreen.js';
import { ProvidersScreen } from './components/screens/ProvidersScreen.js';
import { SubscriptionsScreen } from './components/screens/SubscriptionsScreen.js';
import { TransactionsScreen } from './components/screens/TransactionsScreen.js';
import { AnalyticsScreen } from './components/screens/AnalyticsScreen.js';
import { DeveloperScreen } from './components/screens/DeveloperScreen.js';
import { NotificationsScreen } from './components/screens/NotificationsScreen.js';
import { SettingsScreen } from './components/screens/SettingsScreen.js';
import { CreateAgentWizard } from './components/modals/CreateAgentWizard.js';
import { AttackSimulatorModal, SimulatorExecutionResult } from './components/simulator/AttackSimulatorModal.js';
import { CommandPalette } from './components/palette/CommandPalette.js';
import { TelemetryDrawer, TelemetryEvent } from './components/telemetry/TelemetryDrawer.js';
import {
  INITIAL_AGENTS,
  INITIAL_NOTIFICATIONS,
  INITIAL_POLICIES,
  INITIAL_PROVIDERS,
  INITIAL_SUBSCRIPTIONS,
  INITIAL_TRANSACTIONS,
  INITIAL_PENDING_APPROVALS,
} from './data/mockData.js';
import {
  Agent,
  SpendingPolicy,
  Provider,
  Subscription,
  Transaction,
  NotificationItem,
  PendingApproval,
} from './types/dashboard.js';

const INITIAL_TELEMETRY_EVENTS: TelemetryEvent[] = [
  {
    id: 'tel-01',
    timestamp: '17:10:04.120',
    type: 'APPROVED',
    statusCode: 200,
    agent: 'research-agent-01',
    vendor: 'api.helius.xyz',
    amountUsdc: 0.02,
    latencyMs: 0.14,
    signature: '5sol_auth_8k39f1',
    details: { method: 'POST', path: '/v0/token-metadata', policy: 'Tier 1 — Fast-Path' },
  },
  {
    id: 'tel-02',
    timestamp: '17:11:15.890',
    type: 'BLOCKED',
    statusCode: 403,
    agent: 'research-agent-01',
    vendor: 'evil-drainer-api.org',
    amountUsdc: 50.00,
    latencyMs: 0.06,
    details: { reason: 'Unwhitelisted target domain rejected at perimeter', policy: 'Tier 1' },
  },
  {
    id: 'tel-03',
    timestamp: '17:12:44.301',
    type: 'CIRCUIT',
    statusCode: 429,
    agent: 'arbitrage-bot-alpha',
    vendor: 'api.jup.ag',
    amountUsdc: 100.00,
    latencyMs: 0.09,
    details: { reason: 'Rate anomaly: 14 calls/min exceeded limit (12/min)', tripThreshold: '12' },
  },
  {
    id: 'tel-04',
    timestamp: '17:13:02.441',
    type: 'MULTISIG',
    statusCode: 202,
    agent: 'procurement-agent-v2',
    vendor: 'api.aws.amazon.com',
    amountUsdc: 500.00,
    latencyMs: 0.22,
    details: { squadsThreshold: '2/3', signers: ['XiaoArnav', 'Jesse'] },
  },
];

export const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<ScreenId>('overview');
  const [collapsedSidebar, setCollapsedSidebar] = useState(false);
  const [isCreateWizardOpen, setIsCreateWizardOpen] = useState(false);
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Global Keyboard Shortcuts (Cmd+K for Command Palette, Cmd+P for Simulator)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setIsSimulatorOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Theme Switcher (Dark / Light)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('shlita_theme');
    return (saved === 'light' || saved === 'dark') ? saved : 'dark';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('shlita_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Core Data States
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [policies, setPolicies] = useState<SpendingPolicy[]>(INITIAL_POLICIES);
  const [providers, setProviders] = useState<Provider[]>(INITIAL_PROVIDERS);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>(INITIAL_SUBSCRIPTIONS);
  const [transactions, setTransactions] = useState<Transaction[]>(INITIAL_TRANSACTIONS);
  const [notifications, setNotifications] = useState<NotificationItem[]>(INITIAL_NOTIFICATIONS);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>(INITIAL_PENDING_APPROVALS);
  const [telemetryEvents, setTelemetryEvents] = useState<TelemetryEvent[]>(INITIAL_TELEMETRY_EVENTS);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  const [walletBalanceUsdc, setWalletBalanceUsdc] = useState(4250.00);
  const [simulationStep, setSimulationStep] = useState(0);

  // Unread notifications count
  const unreadCount = notifications.filter((n) => n.unread).length;

  // --- Telemetry Dispatcher Helper ---
  const addTelemetryLog = (event: Omit<TelemetryEvent, 'id' | 'timestamp'>) => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
    const newEv: TelemetryEvent = {
      ...event,
      id: `tel-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: timeStr,
    };
    setTelemetryEvents((prev) => [newEv, ...prev]);
  };

  // --- Handlers ---
  const handleToggleAgentPause = (agentId: string) => {
    setAgents((prev) =>
      prev.map((a) => {
        if (a.id === agentId) {
          const nextStatus = a.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
          return { ...a, status: nextStatus };
        }
        return a;
      })
    );
  };

  const handleResetCircuitBreaker = (agentId: string) => {
    setAgents((prev) =>
      prev.map((a) => {
        if (a.id === agentId) {
          return { ...a, status: 'ACTIVE', circuitTrippedReason: undefined };
        }
        return a;
      })
    );
    addTelemetryLog({
      type: 'APPROVED',
      statusCode: 200,
      agent: agentId,
      vendor: 'circuit-reset-relay',
      amountUsdc: 0,
      latencyMs: 0.05,
      details: { action: 'CIRCUIT_BREAKER_RESET', operator: 'XiaoArnav' },
    });
    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        title: `Circuit Breaker Reset: ${agentId}`,
        description: 'Agent restored to ACTIVE status by human operator.',
        timestamp: 'Just now',
        unread: true,
        type: 'SUCCESS',
      },
      ...prev,
    ]);
  };

  const handleAddAgent = (newAgent: Agent) => {
    setAgents([newAgent, ...agents]);
    addTelemetryLog({
      type: 'APPROVED',
      statusCode: 201,
      agent: newAgent.name,
      vendor: 'solana-subscriptions-pda',
      amountUsdc: 0,
      latencyMs: 0.18,
      details: { action: 'CREATE_AGENT', wallet: newAgent.walletAddress, dailyBudget: newAgent.dailyBudgetUsdc },
    });
    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        title: `New Agent Registered: ${newAgent.name}`,
        description: `Allocated $${newAgent.dailyBudgetUsdc}/day with ${newAgent.allowedVendors.length} whitelisted providers.`,
        timestamp: 'Just now',
        unread: true,
        type: 'AUTH_UPDATE',
      },
      ...prev,
    ]);
  };

  const handleAddPolicy = (newPolicy: SpendingPolicy) => {
    setPolicies([newPolicy, ...policies]);
  };

  const handleAddProvider = (newProv: Provider) => {
    setProviders([newProv, ...providers]);
  };

  const handleToggleSubPause = (id: string) => {
    setSubscriptions((prev) =>
      prev.map((s) => {
        if (s.id === id) {
          return { ...s, status: s.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' };
        }
        return s;
      })
    );
  };

  const handleCancelSub = (id: string) => {
    setSubscriptions((prev) =>
      prev.map((s) => {
        if (s.id === id) {
          return { ...s, status: 'CANCELLED' };
        }
        return s;
      })
    );
  };

  // --- Interactive Agents Screen Handlers ---
  const handleUpdateAgentBudget = (agentId: string, dailyBudget: number, monthlyBudget: number) => {
    setAgents((prev) =>
      prev.map((a) =>
        a.id === agentId ? { ...a, dailyBudgetUsdc: dailyBudget, monthlyBudgetUsdc: monthlyBudget } : a
      )
    );
    addTelemetryLog({
      type: 'APPROVED',
      statusCode: 200,
      agent: agentId,
      vendor: 'solana-subscriptions',
      amountUsdc: dailyBudget,
      latencyMs: 0.12,
      details: { action: 'UPDATE_BUDGET', dailyBudget, monthlyBudget },
    });
  };

  const handleUpdateAgentVendors = (agentId: string, vendors: string[]) => {
    setAgents((prev) =>
      prev.map((a) => (a.id === agentId ? { ...a, allowedVendors: vendors } : a))
    );
    addTelemetryLog({
      type: 'APPROVED',
      statusCode: 200,
      agent: agentId,
      vendor: 'policy-gateway',
      amountUsdc: 0,
      latencyMs: 0.08,
      details: { action: 'UPDATE_WHITELIST', count: vendors.length, vendors },
    });
  };

  const handleMasterTogglePauseAll = (freeze: boolean) => {
    setAgents((prev) => prev.map((a) => ({ ...a, status: freeze ? 'PAUSED' : 'ACTIVE' })));
    addTelemetryLog({
      type: freeze ? 'BLOCKED' : 'APPROVED',
      statusCode: freeze ? 403 : 200,
      agent: 'FLEET_ALL',
      vendor: 'perimeter-firewall',
      amountUsdc: 0,
      latencyMs: 0.15,
      details: { action: freeze ? 'EMERGENCY_FREEZE_ALL' : 'FLEET_RESUME_ALL' },
    });
    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        title: freeze ? '🚨 Fleet Master Freeze Engaged' : 'Fleet Active Status Restored',
        description: freeze ? 'All agents paused via control plane master switch.' : 'All agents resumed by operator.',
        timestamp: 'Just now',
        unread: true,
        type: freeze ? 'VIOLATION' : 'SUCCESS',
      },
      ...prev,
    ]);
  };

  // --- Squads Multi-Sig Approval Handler ---
  const handleConfirmMultiSigApproval = (item: {
    id: string;
    agentName: string;
    amountUsdc: number;
    provider: string;
  }) => {
    setPendingApprovals((prev) => prev.filter((p) => p.id !== item.id));

    const newTx: Transaction = {
      id: `tx-multisig-${Date.now()}`,
      signature: `5sqds_${Math.random().toString(36).substring(2, 8)}`,
      agentId: item.agentName,
      agentName: item.agentName,
      providerId: 'prov-squads',
      providerName: item.provider,
      amountUsdc: item.amountUsdc,
      token: 'USDC',
      timestamp: 'Just now',
      status: 'CONFIRMED',
      networkFeeSol: 0.00001,
      policyUsed: 'Tier 3 — High-Security Multi-Sig',
      solanaExplorerUrl: 'https://explorer.solana.com/tx/squads-confirmed',
      fromAddress: 'SQDS4...88xK (Squads Vault)',
      toAddress: `${item.provider.split('.')[0]}...PDA`,
    };

    setTransactions((prev) => [newTx, ...prev]);
    setWalletBalanceUsdc((prev) => Math.max(0, prev - item.amountUsdc));

    addTelemetryLog({
      type: 'MULTISIG',
      statusCode: 200,
      agent: item.agentName,
      vendor: item.provider,
      amountUsdc: item.amountUsdc,
      latencyMs: 0.24,
      signature: newTx.signature,
      details: {
        squadsVault: 'SQDS4...88xK',
        thresholdMet: '2/3',
        coSigners: ['Arnav Patel (XiaoArnav)', 'Jesse (Lead DevOps)'],
      },
    });

    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        title: `Squads Multi-Sig Approved: ${item.agentName}`,
        description: `Allowance of $${item.amountUsdc.toLocaleString()} USDC for ${item.provider} co-signed and dispatched.`,
        timestamp: 'Just now',
        unread: true,
        type: 'SUCCESS',
      },
      ...prev,
    ]);
  };

  // --- CENTERPIECE SIMULATION FLOW ---
  const handleRunSimulation = () => {
    if (simulationStep === 0) {
      // Step 1: Authorized $0.02 call
      const newTx: Transaction = {
        id: `tx-sim-1-${Date.now()}`,
        signature: `5sol_auth_${Math.random().toString(36).substring(2, 8)}`,
        agentId: 'agent-research-01',
        agentName: 'research-agent-01',
        providerId: 'prov-helius',
        providerName: 'Helius RPC & DAS',
        amountUsdc: 0.02,
        token: 'USDC',
        timestamp: 'Just now',
        status: 'CONFIRMED',
        networkFeeSol: 0.000005,
        policyUsed: 'Tier 1 — Autonomous Fast-Path',
        solanaExplorerUrl: 'https://explorer.solana.com/tx/simulated',
        fromAddress: 'Rsr4Wb...11Zx (Agent PDA)',
        toAddress: 'HeliusATA...99Xy (Merchant ATA)',
      };

      setTransactions([newTx, ...transactions]);
      setWalletBalanceUsdc((prev) => prev - 0.02);
      setAgents((prev) =>
        prev.map((a) =>
          a.id === 'agent-research-01'
            ? { ...a, spentThisMonthUsdc: a.spentThisMonthUsdc + 0.02, lastActive: 'Just now' }
            : a
        )
      );

      addTelemetryLog({
        type: 'APPROVED',
        statusCode: 200,
        agent: 'research-agent-01',
        vendor: 'api.helius.xyz',
        amountUsdc: 0.02,
        latencyMs: 0.12,
        signature: newTx.signature,
        details: { route: '/v0/token-metadata', policy: 'Tier 1 — Autonomous Fast-Path' },
      });

      setNotifications((prev) => [
        {
          id: `notif-${Date.now()}`,
          title: 'Authorized Tool Payment Settled',
          description: 'research-agent-01 paid $0.020 USDC to Helius RPC via Solana Subscriptions.',
          timestamp: 'Just now',
          unread: true,
          type: 'SUCCESS',
        },
        ...prev,
      ]);
      setSimulationStep(1);
    } else if (simulationStep === 1) {
      // Step 2: Blocked $0.08 call (exceeds $0.05 per-call cap)
      const blockedTx: Transaction = {
        id: `tx-sim-2-${Date.now()}`,
        signature: `BLOCKED_CAP_${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
        agentId: 'agent-research-01',
        agentName: 'research-agent-01',
        providerId: 'prov-helius',
        providerName: 'Helius Bulk Data Export',
        amountUsdc: 0.08,
        token: 'USDC',
        timestamp: 'Just now',
        status: 'BLOCKED_BY_POLICY',
        networkFeeSol: 0.0,
        failureReason: 'Policy Violation: Request cost ($0.080 USDC) exceeds per-call limit ($0.050 USDC). Intercepted by Shlita Perimeter.',
        policyUsed: 'Tier 1 — Autonomous Fast-Path',
        solanaExplorerUrl: '#',
        fromAddress: 'Rsr4Wb...11Zx (Agent PDA)',
        toAddress: 'HeliusATA...99Xy (Merchant ATA)',
      };

      setTransactions([blockedTx, ...transactions]);
      setSelectedTransaction(blockedTx);

      addTelemetryLog({
        type: 'BLOCKED',
        statusCode: 403,
        agent: 'research-agent-01',
        vendor: 'Helius Bulk Data Export',
        amountUsdc: 0.08,
        latencyMs: 0.07,
        details: { reason: 'Cost exceeds $0.05 limit. Intercepted by Shlita Perimeter.' },
      });

      setNotifications((prev) => [
        {
          id: `notif-${Date.now()}`,
          title: 'Policy Violation Intercepted',
          description: 'research-agent-01 attempted $0.080 call exceeding $0.050 cap. Zero funds drained.',
          timestamp: 'Just now',
          unread: true,
          type: 'VIOLATION',
        },
        ...prev,
      ]);
      setSimulationStep(2);
    } else {
      setSimulationStep(0);
    }
  };

  // --- ATTACK SIMULATOR & PLAYGROUND HANDLER ---
  const handleApplySimulationResult = (result: SimulatorExecutionResult) => {
    const targetAgent = agents.find((a) => a.id === result.agentId);
    const agentName = targetAgent ? targetAgent.name : result.agentId;

    if (result.status === 'CONFIRMED') {
      const newTx: Transaction = {
        id: `tx-sim-${Date.now()}`,
        signature: result.signature || `5sol_auth_${Math.random().toString(36).substring(2, 8)}`,
        agentId: result.agentId,
        agentName,
        providerId: 'prov-live',
        providerName: result.vendor,
        amountUsdc: result.amountUsdc,
        token: 'USDC',
        timestamp: 'Just now',
        status: 'CONFIRMED',
        networkFeeSol: 0.000005,
        policyUsed: 'Tier 1 — Autonomous Fast-Path',
        solanaExplorerUrl: 'https://explorer.solana.com/tx/simulated',
        fromAddress: `${agentName.substring(0, 4)}...PDA`,
        toAddress: `${result.vendor.split('.')[0]}...ATA`,
      };
      setTransactions((prev) => [newTx, ...prev]);
      setWalletBalanceUsdc((prev) => Math.max(0, prev - result.amountUsdc));
      setAgents((prev) =>
        prev.map((a) =>
          a.id === result.agentId
            ? { ...a, spentThisMonthUsdc: a.spentThisMonthUsdc + result.amountUsdc, lastActive: 'Just now' }
            : a
        )
      );

      addTelemetryLog({
        type: 'APPROVED',
        statusCode: 200,
        agent: agentName,
        vendor: result.vendor,
        amountUsdc: result.amountUsdc,
        latencyMs: 0.16,
        signature: newTx.signature,
        details: { simulated: true, action: 'ATTACK_SIMULATOR_ALLOW' },
      });

      setNotifications((prev) => [
        {
          id: `notif-${Date.now()}`,
          title: 'Authorized Payment Settled',
          description: `${agentName} paid $${result.amountUsdc.toFixed(2)} USDC to ${result.vendor} via Solana Subscriptions.`,
          timestamp: 'Just now',
          unread: true,
          type: 'SUCCESS',
        },
        ...prev,
      ]);
    } else if (result.status === 'BLOCKED_BY_POLICY') {
      const blockedTx: Transaction = {
        id: `tx-sim-${Date.now()}`,
        signature: `BLOCKED_${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
        agentId: result.agentId,
        agentName,
        providerId: 'prov-blocked',
        providerName: result.vendor,
        amountUsdc: result.amountUsdc,
        token: 'USDC',
        timestamp: 'Just now',
        status: 'BLOCKED_BY_POLICY',
        networkFeeSol: 0.0,
        failureReason: result.reason || 'Policy Violation: Request intercepted by Shlita Perimeter.',
        policyUsed: 'Tier 1 — Autonomous Fast-Path',
        solanaExplorerUrl: '#',
        fromAddress: `${agentName.substring(0, 4)}...PDA`,
        toAddress: `${result.vendor.split('.')[0]}...ATA`,
      };
      setTransactions((prev) => [blockedTx, ...prev]);
      setSelectedTransaction(blockedTx);

      addTelemetryLog({
        type: 'BLOCKED',
        statusCode: 403,
        agent: agentName,
        vendor: result.vendor,
        amountUsdc: result.amountUsdc,
        latencyMs: 0.08,
        details: { reason: result.reason || 'Blocked by Shlita Perimeter firewall' },
      });

      setNotifications((prev) => [
        {
          id: `notif-${Date.now()}`,
          title: 'Malicious Request Intercepted',
          description: `${agentName} attempted to transact with ${result.vendor}. Firewall protected treasury ($0 drained).`,
          timestamp: 'Just now',
          unread: true,
          type: 'VIOLATION',
        },
        ...prev,
      ]);
    } else if (result.status === 'CIRCUIT_TRIPPED') {
      setAgents((prev) =>
        prev.map((a) =>
          a.id === result.agentId ? { ...a, status: 'CIRCUIT_TRIPPED', lastActive: 'Loop anomaly detected' } : a
        )
      );

      addTelemetryLog({
        type: 'CIRCUIT',
        statusCode: 429,
        agent: agentName,
        vendor: result.vendor,
        amountUsdc: result.amountUsdc,
        latencyMs: 0.11,
        details: { reason: 'Velocity limit exceeded. Circuit tripped. Agent paused.' },
      });

      setNotifications((prev) => [
        {
          id: `notif-${Date.now()}`,
          title: '⚡ Circuit Breaker Tripped',
          description: `${agentName} exceeded velocity limit (burst anomaly). Automatic lock engaged.`,
          timestamp: 'Just now',
          unread: true,
          type: 'VIOLATION',
        },
        ...prev,
      ]);
    }
  };

  // --- EMERGENCY MASTER ACTIONS (COMMAND PALETTE) ---
  const handleEmergencyFreezeAll = () => {
    handleMasterTogglePauseAll(true);
  };

  const handleResetAllCircuits = () => {
    setAgents((prev) =>
      prev.map((a) => (a.status === 'CIRCUIT_TRIPPED' ? { ...a, status: 'ACTIVE' } : a))
    );
    addTelemetryLog({
      type: 'APPROVED',
      statusCode: 200,
      agent: 'FLEET_ALL',
      vendor: 'circuit-reset-relay',
      amountUsdc: 0,
      latencyMs: 0.12,
      details: { action: 'RESET_ALL_CIRCUITS', operator: 'XiaoArnav' },
    });
    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        title: 'Circuit Breakers Cleared',
        description: 'All suspended agents restored to ACTIVE status.',
        timestamp: 'Just now',
        unread: true,
        type: 'SUCCESS',
      },
      ...prev,
    ]);
  };

  const handleExportCsv = () => {
    const headers = ['ID', 'Signature', 'Agent', 'Provider', 'Amount USDC', 'Token', 'Status', 'Timestamp'];
    const rows = transactions.map((t) => [
      t.id,
      t.signature,
      t.agentName,
      t.providerName,
      t.amountUsdc,
      t.token,
      t.status,
      t.timestamp,
    ]);
    const csvContent =
      'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `shlita-audit-ledger-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-background text-text-primary flex transition-colors duration-200">
      {/* Persistent Collapsible Sidebar */}
      <Sidebar
        currentScreen={currentScreen}
        onSelectScreen={setCurrentScreen}
        collapsed={collapsedSidebar}
        onToggleCollapse={() => setCollapsedSidebar(!collapsedSidebar)}
        unreadCount={unreadCount}
        pendingApprovalsCount={pendingApprovals.length}
      />

      {/* Main Workspace Body */}
      <div
        className={`flex-1 flex flex-col min-h-screen transition-all duration-300 ${
          collapsedSidebar ? 'ml-20' : 'ml-64'
        }`}
      >
        {/* Top Header Navigation */}
        <TopNav
          currentScreen={currentScreen}
          onOpenCreateAgent={() => setIsCreateWizardOpen(true)}
          onSelectScreen={setCurrentScreen}
          unreadCount={unreadCount}
          walletBalanceUsdc={walletBalanceUsdc}
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          onOpenSimulator={() => setIsSimulatorOpen(true)}
        />

        {/* Screen Routing */}
        <main className="flex-1 p-6 lg:p-8 max-w-7xl w-full mx-auto pb-20">
          {currentScreen === 'overview' && (
            <OverviewScreen
              agents={agents}
              policies={policies}
              transactions={transactions}
              onSelectScreen={setCurrentScreen}
              onOpenCreateAgent={() => setIsCreateWizardOpen(true)}
              onSelectTransaction={setSelectedTransaction}
              onRunSimulation={handleRunSimulation}
              simulationStep={simulationStep}
              onOpenSimulator={() => setIsSimulatorOpen(true)}
            />
          )}

          {currentScreen === 'agents' && (
            <AgentsScreen
              agents={agents}
              onOpenCreateWizard={() => setIsCreateWizardOpen(true)}
              onToggleAgentPause={handleToggleAgentPause}
              onResetCircuitBreaker={handleResetCircuitBreaker}
              onUpdateAgentBudget={handleUpdateAgentBudget}
              onUpdateAgentVendors={handleUpdateAgentVendors}
              onMasterTogglePauseAll={handleMasterTogglePauseAll}
            />
          )}

          {currentScreen === 'policies' && (
            <PoliciesScreen
              policies={policies}
              onAddPolicy={handleAddPolicy}
              pendingApprovals={pendingApprovals}
              onApproveMultiSig={handleConfirmMultiSigApproval}
            />
          )}

          {currentScreen === 'providers' && (
            <ProvidersScreen providers={providers} onAddProvider={handleAddProvider} />
          )}

          {currentScreen === 'subscriptions' && (
            <SubscriptionsScreen
              subscriptions={subscriptions}
              onToggleSubscriptionPause={handleToggleSubPause}
              onCancelSubscription={handleCancelSub}
            />
          )}

          {currentScreen === 'transactions' && (
            <TransactionsScreen
              transactions={transactions}
              selectedTransaction={selectedTransaction}
              onSelectTransaction={setSelectedTransaction}
            />
          )}

          {currentScreen === 'analytics' && (
            <AnalyticsScreen
              agents={agents}
              providers={providers}
              transactions={transactions}
            />
          )}

          {(currentScreen === 'api-sdk' || currentScreen === 'webhooks') && (
            <DeveloperScreen
              agents={agents}
              onLogTelemetry={(ev) => setTelemetryEvents((prev) => [ev, ...prev])}
            />
          )}

          {currentScreen === 'notifications' && (
            <NotificationsScreen
              notifications={notifications}
              onMarkAllAsRead={() =>
                setNotifications(notifications.map((n) => ({ ...n, unread: false })))
              }
              onClearNotifications={() => setNotifications([])}
            />
          )}

          {currentScreen === 'settings' && <SettingsScreen />}
        </main>
      </div>

      {/* Create Agent Wizard Modal */}
      <CreateAgentWizard
        isOpen={isCreateWizardOpen}
        onClose={() => setIsCreateWizardOpen(false)}
        onCreateAgent={handleAddAgent}
      />

      {/* Interactive Attack Simulator & Circuit Breaker Playground */}
      <AttackSimulatorModal
        isOpen={isSimulatorOpen}
        onClose={() => setIsSimulatorOpen(false)}
        agents={agents}
        onApplyExecution={handleApplySimulationResult}
        onResetCircuitBreaker={handleResetCircuitBreaker}
      />

      {/* Linear-Style Command Palette (Cmd + K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onSelectScreen={setCurrentScreen}
        onOpenSimulator={() => setIsSimulatorOpen(true)}
        onOpenCreateAgent={() => setIsCreateWizardOpen(true)}
        onToggleTheme={toggleTheme}
        theme={theme}
        onEmergencyFreezeAll={handleEmergencyFreezeAll}
        onResetAllCircuits={handleResetAllCircuits}
        onExportCsv={handleExportCsv}
      />

      {/* Real-Time Cyberpunk Live Telemetry Console Drawer */}
      <TelemetryDrawer
        events={telemetryEvents}
        onClearEvents={() => setTelemetryEvents([])}
      />
    </div>
  );
};
