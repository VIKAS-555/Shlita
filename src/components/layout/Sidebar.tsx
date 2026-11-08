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
  ShieldAlert,
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
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentScreen,
  onSelectScreen,
  collapsed,
  onToggleCollapse,
  unreadCount,
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
        <div className="flex items-center space-x-3 overflow-hidden cursor-pointer" onClick={() => onSelectScreen('overview')}>
          <div className="h-10 w-10 min-w-10 rounded-xl bg-gradient-to-tr from-accent-violet to-solana flex items-center justify-center font-bold text-black text-xl shadow-lg shadow-accent-violet/20">
            ש
          </div>
          {!collapsed && (
            <div className="truncate">
              <span className="font-extrabold text-base tracking-tight text-white block">AutoStream</span>
              <span className="text-[10px] text-accent-violet font-mono tracking-wider block uppercase">Agent Banking</span>
            </div>
          )}
        </div>
        <button
          onClick={onToggleCollapse}
          className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
        </button>
      </div>

      {/* Workspace Switcher */}
      {!collapsed && (
        <div className="p-3 border-b border-border/60">
          <div className="flex items-center justify-between bg-card hover:bg-card-elevated border border-border/80 px-3 py-2 rounded-xl text-xs cursor-pointer transition">
            <div className="flex items-center space-x-2.5 truncate">
              <div className="w-2 h-2 rounded-full bg-solana animate-pulse"></div>
              <span className="font-semibold text-slate-200 truncate">TRioN Labs / Prod</span>
            </div>
            <ChevronDown size={14} className="text-slate-400" />
          </div>
        </div>
      )}

      {/* Navigation List */}
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
        {/* Workspace Section */}
        <div>
          {!collapsed && (
            <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Workspace
            </div>
          )}
          <div className="space-y-1">
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
                  } py-2 rounded-xl text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-accent-violet/15 text-accent-violet border border-accent-violet/30 shadow-sm'
                      : 'text-slate-300 hover:bg-slate-850 hover:text-white'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <Icon size={18} className={isActive ? 'text-accent-violet' : 'text-slate-400'} />
                    {!collapsed && <span>{item.label}</span>}
                  </div>
                  {!collapsed && item.badge && (
                    <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded-full font-mono">
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
            <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Developers
            </div>
          )}
          <div className="space-y-1">
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
                  } py-2 rounded-xl text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-accent-violet/15 text-accent-violet border border-accent-violet/30 shadow-sm'
                      : 'text-slate-300 hover:bg-slate-850 hover:text-white'
                  }`}
                >
                  <Icon size={18} className={isActive ? 'text-accent-violet' : 'text-slate-400'} />
                  {!collapsed && <span className="ml-3">{item.label}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Management Section */}
        <div>
          {!collapsed && (
            <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Management
            </div>
          )}
          <div className="space-y-1">
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
                  } py-2 rounded-xl text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-accent-violet/15 text-accent-violet border border-accent-violet/30 shadow-sm'
                      : 'text-slate-300 hover:bg-slate-850 hover:text-white'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <Icon size={18} className={isActive ? 'text-accent-violet' : 'text-slate-400'} />
                    {!collapsed && <span>{item.label}</span>}
                  </div>
                  {!collapsed && (item.count ?? 0) > 0 && (
                    <span className="text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded-full font-mono font-bold">
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* User Profile Card */}
      <div className="p-3 border-t border-border">
        <div
          className={`flex items-center ${
            collapsed ? 'justify-center' : 'space-x-3'
          } p-2 rounded-xl hover:bg-card cursor-pointer transition`}
        >
          <div className="relative">
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-accent-violet to-solana-purple flex items-center justify-center font-bold text-white text-xs shadow-md">
              AP
            </div>
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-solana ring-2 ring-sidebar"></span>
          </div>
          {!collapsed && (
            <div className="truncate text-left">
              <span className="text-xs font-semibold text-white block truncate">Arnav Patel</span>
              <span className="text-[10px] text-slate-400 font-mono block truncate">AuSt...9R8K (Admin)</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
