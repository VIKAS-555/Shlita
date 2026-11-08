import React from 'react';
import {
  LayoutDashboard,
  Bot,
  ShieldCheck,
  Boxes,
  Repeat,
  BarChart3,
  Receipt,
  Webhook,
  Code2,
  Bell,
  Settings,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Sun,
  Moon,
} from 'lucide-react';

export type ScreenId =
  | 'overview'
  | 'agents'
  | 'policies'
  | 'providers'
  | 'subscriptions'
  | 'analytics'
  | 'transactions'
  | 'webhooks'
  | 'api-sdk'
  | 'notifications'
  | 'settings';

interface SidebarProps {
  currentScreen: ScreenId;
  onSelectScreen: (screen: ScreenId) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  unreadCount: number;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentScreen,
  onSelectScreen,
  collapsed,
  onToggleCollapse,
  unreadCount,
  theme,
  onToggleTheme,
}) => {
  const workspaceItems = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'agents', label: 'AI Agents', icon: Bot, badge: '6' },
    { id: 'policies', label: 'Spending Policies', icon: ShieldCheck },
    { id: 'providers', label: 'Providers & Vendors', icon: Boxes },
    { id: 'subscriptions', label: 'Subscriptions', icon: Repeat, badge: '4' },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  ];

  const developerItems = [
    { id: 'transactions', label: 'Transaction Activity', icon: Receipt },
    { id: 'webhooks', label: 'Webhooks', icon: Webhook },
    { id: 'api-sdk', label: 'API & SDK', icon: Code2 },
  ];

  const managementItems = [
    { id: 'notifications', label: 'Notifications', icon: Bell, count: unreadCount },
    { id: 'settings', label: 'Settings & Security', icon: Settings },
  ];

  return (
    <aside
      className={`fixed top-0 left-0 bottom-0 z-40 bg-sidebar border-r border-border transition-all duration-300 flex flex-col ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-border">
        <div
          className="flex items-center space-x-3 overflow-hidden cursor-pointer"
          onClick={() => onSelectScreen('overview')}
        >
          <div className="h-9 w-9 min-w-9 rounded-xl bg-gradient-to-tr from-accent-violet to-solana flex items-center justify-center font-bold text-white text-lg shadow-sm">
            ש
          </div>
          {!collapsed && (
            <div className="truncate">
              <span className="font-bold text-sm tracking-tight text-text-primary block">Shlita</span>
              <span className="text-[10px] text-accent-violet font-mono tracking-wider block uppercase">Control Plane</span>
            </div>
          )}
        </div>
        <button
          onClick={onToggleCollapse}
          className="text-text-muted hover:text-text-primary p-1 rounded-lg hover:bg-card-elevated transition"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>

      {/* Workspace Switcher */}
      {!collapsed && (
        <div className="p-3 border-b border-border/60">
          <div className="flex items-center justify-between bg-card-elevated hover:bg-border/60 border border-border px-3 py-2 rounded-xl text-xs cursor-pointer transition">
            <div className="flex items-center space-x-2.5 truncate">
              <div className="w-2 h-2 rounded-full bg-solana animate-pulse"></div>
              <span className="font-semibold text-text-secondary truncate">TRioN Labs / Prod</span>
            </div>
            <ChevronDown size={14} className="text-text-muted" />
          </div>
        </div>
      )}

      {/* Navigation List */}
      <div className="flex-1 overflow-y-auto py-3 px-3 space-y-5">
        {/* Workspace Section */}
        <div>
          {!collapsed && (
            <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-text-faint font-mono">
              Workspace
            </div>
          )}
          <div className="space-y-0.5">
            {workspaceItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentScreen === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectScreen(item.id as ScreenId)}
                  title={collapsed ? item.label : undefined}
                  className={`w-full flex items-center ${
                    collapsed ? 'justify-center px-0' : 'justify-between px-3'
                  } py-2 rounded-xl text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-accent-violet/10 text-accent-violet font-semibold border border-accent-violet/20'
                      : 'text-text-secondary hover:bg-card-elevated hover:text-text-primary'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <Icon size={16} className={isActive ? 'text-accent-violet' : 'text-text-muted'} />
                    {!collapsed && <span>{item.label}</span>}
                  </div>
                  {!collapsed && item.badge && (
                    <span className="text-[10px] bg-card-elevated text-text-muted px-1.5 py-0.5 rounded-full font-mono border border-border">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Developers Section */}
        <div>
          {!collapsed && (
            <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-text-faint font-mono">
              Developers
            </div>
          )}
          <div className="space-y-0.5">
            {developerItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentScreen === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectScreen(item.id as ScreenId)}
                  title={collapsed ? item.label : undefined}
                  className={`w-full flex items-center ${
                    collapsed ? 'justify-center px-0' : 'justify-start px-3'
                  } py-2 rounded-xl text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-accent-violet/10 text-accent-violet font-semibold border border-accent-violet/20'
                      : 'text-text-secondary hover:bg-card-elevated hover:text-text-primary'
                  }`}
                >
                  <Icon size={16} className={isActive ? 'text-accent-violet' : 'text-text-muted'} />
                  {!collapsed && <span className="ml-3">{item.label}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Management Section */}
        <div>
          {!collapsed && (
            <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-text-faint font-mono">
              Management
            </div>
          )}
          <div className="space-y-0.5">
            {managementItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentScreen === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectScreen(item.id as ScreenId)}
                  title={collapsed ? item.label : undefined}
                  className={`w-full flex items-center ${
                    collapsed ? 'justify-center px-0' : 'justify-between px-3'
                  } py-2 rounded-xl text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-accent-violet/10 text-accent-violet font-semibold border border-accent-violet/20'
                      : 'text-text-secondary hover:bg-card-elevated hover:text-text-primary'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <Icon size={16} className={isActive ? 'text-accent-violet' : 'text-text-muted'} />
                    {!collapsed && <span>{item.label}</span>}
                  </div>
                  {!collapsed && (item.count ?? 0) > 0 && (
                    <span className="text-[10px] bg-red-500/15 text-red-500 border border-red-500/20 px-1.5 py-0.5 rounded-full font-mono font-bold">
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Theme Switch & User Profile */}
      <div className="p-3 border-t border-border space-y-2">
        {/* Black & White Theme Switcher Button (ExpenseVista style) */}
        <button
          onClick={onToggleTheme}
          className={`w-full flex items-center ${
            collapsed ? 'justify-center' : 'justify-between px-3'
          } py-1.5 rounded-xl text-xs font-medium bg-card-elevated border border-border text-text-secondary hover:text-text-primary hover:border-border-hover transition`}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          <div className="flex items-center space-x-2">
            {theme === 'dark' ? <Sun size={14} className="text-amber-400" /> : <Moon size={14} className="text-accent-violet" />}
            {!collapsed && <span>{theme === 'dark' ? 'Switch to light' : 'Switch to dark'}</span>}
          </div>
          {!collapsed && (
            <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded bg-card text-text-muted border border-border">
              {theme}
            </span>
          )}
        </button>

        {/* Profile Card */}
        <div
          className={`flex items-center ${
            collapsed ? 'justify-center' : 'space-x-3'
          } p-1.5 rounded-xl hover:bg-card-elevated cursor-pointer transition`}
        >
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-accent-violet to-solana flex items-center justify-center font-bold text-white text-xs shadow-sm">
              AP
            </div>
            <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-solana ring-2 ring-sidebar"></span>
          </div>
          {!collapsed && (
            <div className="truncate text-left">
              <span className="text-xs font-semibold text-text-primary block truncate">Arnav Patel</span>
              <span className="text-[10px] text-text-muted font-mono block truncate">AuSt...9R8K (Admin)</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
