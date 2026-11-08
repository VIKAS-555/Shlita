import React, { useState } from 'react';
import {
  Bell,
  Wallet,
  Plus,
  ShieldCheck,
  Sun,
  Moon,
  Search,
  Zap,
} from 'lucide-react';
import { ScreenId } from './Sidebar.js';

interface TopNavProps {
  currentScreen: ScreenId;
  onOpenCreateAgent: () => void;
  onSelectScreen: (screen: ScreenId) => void;
  unreadCount: number;
  walletBalanceUsdc: number;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenCommandPalette: () => void;
  onOpenSimulator: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  currentScreen,
  onOpenCreateAgent,
  onSelectScreen,
  unreadCount,
  walletBalanceUsdc,
  theme,
  onToggleTheme,
  onOpenCommandPalette,
  onOpenSimulator,
}) => {
  const [network, setNetwork] = useState<'mainnet-beta' | 'devnet'>('mainnet-beta');
  const [walletConnected, setWalletConnected] = useState(true);

  const screenTitles: Record<ScreenId, string> = {
    overview: 'Overview Command Center',
    agents: 'AI Agent Management',
    policies: 'Spending Policies & Guardrails',
    providers: 'Approved Providers & Vendors',
    subscriptions: 'Recurring Subscriptions',
    analytics: 'Financial Analytics',
    transactions: 'Transaction Activity Explorer',
    webhooks: 'Developer Webhooks',
    'api-sdk': 'API Keys & Developer SDK',
    notifications: 'Notifications & Alerts',
    settings: 'Organization Settings & Security',
  };

  return (
    <header className="h-16 border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between px-6 transition-colors">
      {/* Breadcrumbs */}
      <div className="flex items-center space-x-2 text-xs">
        <span className="text-text-muted">Shlita</span>
        <span className="text-text-faint">/</span>
        <span className="text-text-muted">TRioN Labs</span>
        <span className="text-text-faint">/</span>
        <span className="text-text-primary font-semibold">{screenTitles[currentScreen]}</span>
      </div>

      {/* Center Command Palette Quick Search Pill */}
      <button
        onClick={onOpenCommandPalette}
        className="hidden md:flex items-center space-x-2 bg-card-elevated hover:bg-border/80 border border-border px-3.5 py-1.5 rounded-xl text-xs text-text-muted hover:text-text-primary transition font-sans shadow-sm cursor-pointer"
        title="Quick Command Palette (⌘K)"
      >
        <Search size={13} className="text-text-muted" />
        <span className="text-[11px]">Search actions & commands...</span>
        <kbd className="text-[10px] bg-card px-1.5 py-0.5 rounded border border-border font-mono text-text-faint">
          ⌘K
        </kbd>
      </button>

      {/* Right Controls */}
      <div className="flex items-center space-x-2.5">
        {/* Attack Simulator Live Button */}
        <button
          onClick={onOpenSimulator}
          className="flex items-center space-x-1.5 bg-accent-violet/10 hover:bg-accent-violet/20 border border-accent-violet/30 text-accent-violet font-semibold text-xs px-3 py-1.5 rounded-xl transition shadow-sm cursor-pointer"
          title="Open Attack Simulator & Circuit Breaker Playground (⌘P)"
        >
          <Zap size={13} className="text-accent-violet fill-accent-violet/20" />
          <span className="hidden sm:inline">Simulator</span>
        </button>

        {/* Network Indicator */}
        <div className="flex items-center space-x-2 bg-card-elevated border border-border px-3 py-1.5 rounded-xl text-xs">
          <div className="w-2 h-2 rounded-full bg-solana animate-pulse"></div>
          <select
            value={network}
            onChange={(e) => setNetwork(e.target.value as any)}
            className="bg-transparent text-text-secondary text-xs font-mono outline-none cursor-pointer"
          >
            <option value="mainnet-beta" className="bg-card text-text-primary">Solana Mainnet</option>
            <option value="devnet" className="bg-card text-text-primary">Solana Devnet</option>
          </select>
        </div>

        {/* System Health */}
        <div className="hidden lg:flex items-center space-x-1.5 text-xs text-text-muted bg-card-elevated border border-border px-3 py-1.5 rounded-xl font-mono">
          <ShieldCheck size={14} className="text-emerald-500" />
          <span>Policies Active</span>
        </div>

        {/* Wallet Connection */}
        <button
          onClick={() => setWalletConnected(!walletConnected)}
          className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl text-xs font-mono border transition ${
            walletConnected
              ? 'bg-card-elevated border-border text-text-primary hover:border-border-hover'
              : 'bg-accent-violet/10 border-accent-violet/30 text-accent-violet'
          }`}
        >
          <Wallet size={14} className="text-solana" />
          <span>{walletConnected ? `$${walletBalanceUsdc.toLocaleString('en-US', { minimumFractionDigits: 2 })} USDC` : 'Connect Wallet'}</span>
        </button>

        {/* Theme Toggle (Dark / Light Switch) */}
        <button
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to Light mode' : 'Switch to Dark mode'}
          className="flex items-center justify-center p-2 rounded-xl text-text-muted hover:text-text-primary bg-card-elevated border border-border hover:border-border-hover transition cursor-pointer"
        >
          {theme === 'dark' ? <Sun size={15} className="text-amber-400" /> : <Moon size={15} className="text-accent-violet" />}
        </button>

        {/* Review Approvals Pill */}
        <button
          onClick={() => onSelectScreen('policies')}
          className="hidden sm:flex items-center space-x-1.5 bg-gradient-to-r from-accent-violet to-solana-purple hover:opacity-95 text-white font-semibold text-xs px-3.5 py-1.5 rounded-xl shadow-sm transition"
        >
          <span>Review Approvals (3)</span>
        </button>

        {/* Create Agent Action */}
        <button
          onClick={onOpenCreateAgent}
          className="flex items-center space-x-1.5 bg-card-elevated hover:bg-border text-text-primary font-medium text-xs px-3 py-1.5 rounded-xl border border-border transition"
        >
          <Plus size={14} />
          <span className="hidden sm:inline">Create Agent</span>
        </button>

        {/* Notifications Bell */}
        <button
          onClick={() => onSelectScreen('notifications')}
          className="relative p-2 rounded-xl text-text-muted hover:text-text-primary bg-card-elevated border border-border hover:border-border-hover transition"
        >
          <Bell size={16} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
};
