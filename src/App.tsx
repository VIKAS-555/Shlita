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
import {
  INITIAL_AGENTS,
  INITIAL_NOTIFICATIONS,
  INITIAL_POLICIES,
  INITIAL_PROVIDERS,
  INITIAL_SUBSCRIPTIONS,
  INITIAL_TRANSACTIONS,
} from './data/mockData.js';
import { Agent, SpendingPolicy, Provider, Subscription, Transaction, NotificationItem } from './types/dashboard.js';

export const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<ScreenId>('overview');
  const [collapsedSidebar, setCollapsedSidebar] = useState(false);
  const [isCreateWizardOpen, setIsCreateWizardOpen] = useState(false);

  // Black & White Theme Switcher (Dark / Light)
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
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  const [walletBalanceUsdc, setWalletBalanceUsdc] = useState(4250.00);
  const [simulationStep, setSimulationStep] = useState(0);

  // Unread notifications count
  const unreadCount = notifications.filter((n) => n.unread).length;

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

  return (
    <div className="min-h-screen bg-background text-text-primary flex transition-colors duration-200">
      {/* Persistent Collapsible Sidebar */}
      <Sidebar
        currentScreen={currentScreen}
        onSelectScreen={setCurrentScreen}
        collapsed={collapsedSidebar}
        onToggleCollapse={() => setCollapsedSidebar(!collapsedSidebar)}
        unreadCount={unreadCount}
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
        />

        {/* Screen Routing */}
        <main className="flex-1 p-6 lg:p-8 max-w-7xl w-full mx-auto">
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
            />
          )}

          {currentScreen === 'agents' && (
            <AgentsScreen
              agents={agents}
              onOpenCreateWizard={() => setIsCreateWizardOpen(true)}
              onToggleAgentPause={handleToggleAgentPause}
              onResetCircuitBreaker={handleResetCircuitBreaker}
            />
          )}

          {currentScreen === 'policies' && (
            <PoliciesScreen policies={policies} onAddPolicy={handleAddPolicy} />
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
            <DeveloperScreen />
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
    </div>
  );
};
