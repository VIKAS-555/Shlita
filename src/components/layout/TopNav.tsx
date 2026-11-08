import React, { useState } from 'react';
import {
  Bell,
  Wallet,
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
  onSelectScreen,
  unreadCount,
  walletBalanceUsdc,
  theme,
  onToggleTheme,
  onOpenCommandPalette,
  onOpenSimulator,
}) => {
  const [walletConnected, setWalletConnected] = useState(true);

  const screenTitles: Record<ScreenId, string> = {
    overview: 'Overview',
    agents: 'AI Agents',
    policies: 'Spending Policies',
    providers: 'Approved Providers',
    subscriptions: 'Subscriptions',
    analytics: 'Analytics',
    transactions: 'Transactions',
    webhooks: 'Webhooks',
    'api-sdk': 'Developer Center',
    notifications: 'Notifications',
    settings: 'Settings & Security',
  };

  return (
    <header className="h-16 px-6 sticky top-0 z-30 flex items-center justify-between border-b border-border bg-card/60 backdrop-blur-xl transition-all">
      {/* Left: Clean Breadcrumbs */}
      <div className="flex items-center space-x-2 text-xs">
        <span className="text-text-muted hover:text-text-primary transition cursor-pointer">TRioN Labs</span>
        <span className="text-text-faint">/</span>
        <span className="text-text-primary font-semibold">{screenTitles[currentScreen]}</span>
      </div>

      {/* Center: Sleek Search Capsule (Linear Style) */}
      <button
        onClick={onOpenCommandPalette}
        className="hidden md:flex items-center space-x-2.5 bg-card-elevated/70 hover:bg-card-elevated border border-border hover:border-border-hover px-4 py-1.5 rounded-full text-xs text-text-muted hover:text-text-primary transition shadow-sm w-72 justify-between cursor-pointer group"
        title="Open Command Palette (⌘K)"
      >
        <div className="flex items-center space-x-2 truncate">
          <Search size={13} className="text-text-muted group-hover:text-accent-violet transition-colors" />
          <span className="text-[11px] truncate">Search or jump to...</span>
        </div>
        <kbd className="text-[10px] bg-card px-1.5 py-0.5 rounded-md border border-border font-mono text-text-faint">
          ⌘K
        </kbd>
      </button>

      {/* Right: Unified & Decluttered Controls */}
      <div className="flex items-center space-x-2.5">
        {/* Network & Policy Status Pill */}
        <div
          className="flex items-center space-x-2 bg-card-elevated/60 border border-border px-3 py-1.5 rounded-full text-xs font-mono"
          title="Solana Mainnet: Policies Active & Enforcing"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-solana opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-solana"></span>
          </span>
          <span className="text-text-secondary text-[11px]">Mainnet</span>
        </div>

        {/* Wallet Balance Pill */}
        <button
          onClick={() => setWalletConnected(!walletConnected)}
          className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-full text-xs font-mono border transition shadow-sm cursor-pointer ${
            walletConnected
              ? 'bg-card-elevated/60 border-border text-text-primary hover:border-border-hover'
              : 'bg-accent-violet/10 border-accent-violet/30 text-accent-violet'
          }`}
          title="Connected Treasury Vault"
        >
          <Wallet size={13} className="text-solana" />
          <span className="text-[11px] font-semibold">
            {walletConnected ? `$${walletBalanceUsdc.toLocaleString('en-US', { minimumFractionDigits: 2 })} USDC` : 'Connect'}
          </span>
        </button>

        {/* Single Primary Action: Simulator */}
        <button
          onClick={onOpenSimulator}
          className="flex items-center space-x-1.5 bg-gradient-to-r from-accent-violet to-solana-purple hover:opacity-95 text-white font-semibold text-xs px-3.5 py-1.5 rounded-full shadow-sm transition cursor-pointer"
          title="Open Attack Simulator & Circuit Breaker Playground (⌘P)"
        >
          <Zap size={13} className="fill-white" />
          <span className="hidden sm:inline">Simulator</span>
        </button>

        {/* Utilities: Theme Switcher & Notifications */}
        <div className="flex items-center space-x-0.5 pl-1.5 border-l border-border/80">
          <button
            onClick={onToggleTheme}
            className="p-1.5 rounded-xl text-text-muted hover:text-text-primary hover:bg-card-elevated transition cursor-pointer"
            title={theme === 'dark' ? 'Switch to Light mode' : 'Switch to Dark mode'}
          >
            {theme === 'dark' ? <Sun size={15} className="text-amber-400" /> : <Moon size={15} className="text-accent-violet" />}
          </button>

          <button
            onClick={() => onSelectScreen('notifications')}
            className="relative p-1.5 rounded-xl text-text-muted hover:text-text-primary hover:bg-card-elevated transition cursor-pointer"
            title="Notifications"
          >
            <Bell size={15} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500"></span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
