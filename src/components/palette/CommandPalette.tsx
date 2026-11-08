import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Command,
  LayoutDashboard,
  Bot,
  ShieldCheck,
  Boxes,
  Repeat,
  BarChart3,
  Receipt,
  Code2,
  Settings,
  Zap,
  ShieldAlert,
  RotateCcw,
  Plus,
  Sun,
  Moon,
  Download,
  Globe,
  CornerDownLeft,
  Sparkles,
} from 'lucide-react';
import { ScreenId } from '../layout/Sidebar.js';

export interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  category: 'Navigation' | 'Actions & Security' | 'System & Tools';
  icon: React.ElementType;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectScreen: (screen: ScreenId) => void;
  onOpenSimulator: () => void;
  onOpenCreateAgent: () => void;
  onToggleTheme: () => void;
  theme: 'dark' | 'light';
  onEmergencyFreezeAll: () => void;
  onResetAllCircuits: () => void;
  onExportCsv: () => void;
  onOpenTour?: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onSelectScreen,
  onOpenSimulator,
  onOpenCreateAgent,
  onToggleTheme,
  theme,
  onEmergencyFreezeAll,
  onResetAllCircuits,
  onExportCsv,
  onOpenTour,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: CommandItem[] = [
    // Tour & Guided Demo
    {
      id: 'open-tour',
      title: 'Start 60-Second Guided Demo Tour',
      subtitle: 'Walk through all 5 architectural defense tiers with interactive auto-play',
      category: 'Actions & Security',
      icon: Sparkles,
      action: () => {
        if (onOpenTour) onOpenTour();
        onClose();
      },
    },
    // Security & Simulator Actions
    {
      id: 'open-simulator',
      title: 'Launch Attack Simulator & Playground',
      subtitle: 'Simulate live prompt injections, cap violations & loop circuit breaker trips',
      category: 'Actions & Security',
      icon: Zap,
      shortcut: '⌘P',
      action: () => {
        onOpenSimulator();
        onClose();
      },
    },
    {
      id: 'emergency-freeze',
      title: 'Emergency Master Freeze: Pause All Agents',
      subtitle: 'Immediately lock all agent spending permissions across the organization',
      category: 'Actions & Security',
      icon: ShieldAlert,
      action: () => {
        onEmergencyFreezeAll();
        onClose();
      },
    },
    {
      id: 'reset-circuits',
      title: 'Reset All Tripped Circuit Breakers',
      subtitle: 'Clear error cascades and restore suspended agents back to ACTIVE status',
      category: 'Actions & Security',
      icon: RotateCcw,
      action: () => {
        onResetAllCircuits();
        onClose();
      },
    },
    {
      id: 'create-agent',
      title: 'Provision New Autonomous Agent',
      subtitle: 'Deploy a new agent with strict USDC spending caps and Solana allowance PDA',
      category: 'Actions & Security',
      icon: Plus,
      shortcut: '⌘N',
      action: () => {
        onOpenCreateAgent();
        onClose();
      },
    },

    // Navigation Screens
    {
      id: 'nav-overview',
      title: 'Go to Overview Command Center',
      subtitle: 'High-level financial KPIs, budget utilization, and recent telemetry',
      category: 'Navigation',
      icon: LayoutDashboard,
      shortcut: 'G O',
      action: () => {
        onSelectScreen('overview');
        onClose();
      },
    },
    {
      id: 'nav-agents',
      title: 'Go to AI Agents Management',
      subtitle: 'Inspect agents, environments, budgets, and pause/resume states',
      category: 'Navigation',
      icon: Bot,
      shortcut: 'G A',
      action: () => {
        onSelectScreen('agents');
        onClose();
      },
    },
    {
      id: 'nav-policies',
      title: 'Go to Spending Policies & Guardrails',
      subtitle: 'Configure approval limits and Squads multi-sig co-signing thresholds',
      category: 'Navigation',
      icon: ShieldCheck,
      action: () => {
        onSelectScreen('policies');
        onClose();
      },
    },
    {
      id: 'nav-providers',
      title: 'Go to Approved Providers & Vendors',
      subtitle: 'Manage verified RPC and AI inference endpoints',
      category: 'Navigation',
      icon: Boxes,
      action: () => {
        onSelectScreen('providers');
        onClose();
      },
    },
    {
      id: 'nav-subscriptions',
      title: 'Go to Recurring Subscriptions',
      subtitle: 'Monitor active Web3 Direct Debit streams powered by Solana Subscriptions',
      category: 'Navigation',
      icon: Repeat,
      action: () => {
        onSelectScreen('subscriptions');
        onClose();
      },
    },
    {
      id: 'nav-analytics',
      title: 'Go to Financial Analytics',
      subtitle: 'Interactive charts for agent spend comparison and category allocation',
      category: 'Navigation',
      icon: BarChart3,
      action: () => {
        onSelectScreen('analytics');
        onClose();
      },
    },
    {
      id: 'nav-transactions',
      title: 'Go to Transaction Activity Explorer',
      subtitle: 'Complete on-chain ledger signatures and policy audit trail',
      category: 'Navigation',
      icon: Receipt,
      action: () => {
        onSelectScreen('transactions');
        onClose();
      },
    },
    {
      id: 'nav-developers',
      title: 'Go to Developer Center & API SDK',
      subtitle: 'API keys, cURL interactive proxy sandbox, and SDK snippets',
      category: 'Navigation',
      icon: Code2,
      action: () => {
        onSelectScreen('api-sdk');
        onClose();
      },
    },
    {
      id: 'nav-settings',
      title: 'Go to Settings & Security Governance',
      subtitle: 'RPC endpoints, allowance program IDs, and multi-sig signers',
      category: 'Navigation',
      icon: Settings,
      action: () => {
        onSelectScreen('settings');
        onClose();
      },
    },

    // System & Tools
    {
      id: 'toggle-theme',
      title: theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme',
      subtitle: 'Toggle between soft dark charcoal and clean slate light theme',
      category: 'System & Tools',
      icon: theme === 'dark' ? Sun : Moon,
      shortcut: '⌘T',
      action: () => {
        onToggleTheme();
        onClose();
      },
    },
    {
      id: 'export-csv',
      title: 'Export Transaction Audit Trail (CSV)',
      subtitle: 'Download complete transaction telemetry spreadsheet',
      category: 'System & Tools',
      icon: Download,
      action: () => {
        onExportCsv();
        onClose();
      },
    },
  ];

  const filtered = commands.filter((cmd) => {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    return (
      cmd.title.toLowerCase().includes(q) ||
      (cmd.subtitle && cmd.subtitle.toLowerCase().includes(q)) ||
      cmd.category.toLowerCase().includes(q)
    );
  });

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % (filtered.length || 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % (filtered.length || 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          filtered[selectedIndex].action();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filtered, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-20 px-4 animate-in fade-in duration-150">
      <div
        className="bg-card border border-border w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Header */}
        <div className="flex items-center px-4 py-3.5 border-b border-border bg-card-elevated">
          <Search size={18} className="text-text-muted mr-3 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command or search actions (e.g. simulator, freeze, theme)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-sm text-text-primary placeholder-text-muted outline-none font-sans"
          />
          <div className="flex items-center space-x-1.5 shrink-0 text-[10px] font-mono text-text-faint bg-card px-2 py-1 rounded-md border border-border">
            <span>ESC to close</span>
          </div>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-text-muted font-mono">
              No actions matching "{query}"
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={item.action}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer text-xs transition ${
                    isSelected
                      ? 'bg-accent-violet text-white shadow-sm'
                      : 'text-text-secondary hover:bg-card-elevated'
                  }`}
                >
                  <div className="flex items-center space-x-3 truncate">
                    <div
                      className={`p-1.5 rounded-lg shrink-0 ${
                        isSelected
                          ? 'bg-white/20 text-white'
                          : 'bg-card-elevated text-accent-violet border border-border'
                      }`}
                    >
                      <Icon size={16} />
                    </div>
                    <div className="truncate">
                      <div className={`font-semibold truncate ${isSelected ? 'text-white' : 'text-text-primary'}`}>
                        {item.title}
                      </div>
                      {item.subtitle && (
                        <div
                          className={`text-[11px] truncate font-sans ${
                            isSelected ? 'text-white/80' : 'text-text-muted'
                          }`}
                        >
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0 ml-3">
                    {item.shortcut && (
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                          isSelected
                            ? 'bg-white/20 border-white/30 text-white'
                            : 'bg-card border-border text-text-muted'
                        }`}
                      >
                        {item.shortcut}
                      </span>
                    )}
                    {isSelected && <CornerDownLeft size={13} className="text-white/90" />}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Navigation Hints */}
        <div className="px-4 py-2 border-t border-border bg-card-elevated flex items-center justify-between text-[11px] text-text-muted font-mono">
          <div className="flex items-center space-x-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>ESC Dismiss</span>
          </div>
          <span className="text-solana font-semibold">Shlita Command Plane</span>
        </div>
      </div>
    </div>
  );
};
