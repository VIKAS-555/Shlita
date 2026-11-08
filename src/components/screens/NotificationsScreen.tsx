import React, { useState } from 'react';
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Clock,
  Trash2,
} from 'lucide-react';
import { NotificationItem } from '../../types/dashboard.js';

interface NotificationsScreenProps {
  notifications: NotificationItem[];
  onMarkAllAsRead: () => void;
  onClearNotifications: () => void;
}

export const NotificationsScreen: React.FC<NotificationsScreenProps> = ({
  notifications,
  onMarkAllAsRead,
  onClearNotifications,
}) => {
  const [filterType, setFilterType] = useState<string>('ALL');

  const filtered = notifications.filter((n) => {
    if (filterType === 'ALL') return true;
    if (filterType === 'UNREAD') return n.unread;
    return n.type === filterType;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h2 className="text-xl font-bold text-text-primary tracking-tight">Notifications & System Alerts</h2>
          <p className="text-xs text-text-muted mt-1">
            Real-time security telemetry, spending cap triggers, and circuit breaker trip notifications.
          </p>
        </div>
        <div className="flex items-center space-x-2.5">
          <button
            onClick={onMarkAllAsRead}
            className="text-xs bg-card hover:bg-card-elevated border border-border text-text-secondary hover:text-text-primary px-3.5 py-1.5 rounded-xl transition shadow-sm"
          >
            Mark all read
          </button>
          <button
            onClick={onClearNotifications}
            className="text-xs text-text-muted hover:text-red-500 p-1.5 transition rounded-lg hover:bg-card-elevated"
            title="Clear all alerts"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center space-x-1.5 bg-card border border-border p-1 rounded-xl text-xs font-mono w-fit">
        {(['ALL', 'UNREAD', 'VIOLATION', 'FAILED_PAYMENT', 'SUCCESS'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className={`px-3 py-1.5 rounded-lg transition ${
              filterType === t
                ? 'bg-accent-violet text-white font-semibold shadow-sm'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {t === 'ALL' ? 'All Alerts' : t.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Notifications List - Soft, clean, and balanced */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden divide-y divide-border/60 shadow-sm">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-text-muted text-xs">No notifications match this filter.</div>
        ) : (
          filtered.map((item) => (
            <div
              key={item.id}
              className={`p-4 sm:p-5 flex items-start space-x-4 hover:bg-card-elevated/60 transition ${
                item.unread ? 'bg-accent-violet/[0.03]' : ''
              }`}
            >
              <div className="mt-0.5">
                {item.type === 'VIOLATION' && (
                  <div className="w-8 h-8 rounded-xl bg-red-500/10 text-red-500 border border-red-500/20 flex items-center justify-center">
                    <ShieldAlert size={16} />
                  </div>
                )}
                {item.type === 'FAILED_PAYMENT' && (
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center justify-center">
                    <AlertTriangle size={16} />
                  </div>
                )}
                {item.type === 'SUCCESS' && (
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 flex items-center justify-center">
                    <CheckCircle2 size={16} />
                  </div>
                )}
              </div>

              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-text-primary text-xs">{item.title}</h4>
                  <span className="text-[10px] text-text-faint font-mono">{item.timestamp}</span>
                </div>
                <p className="text-xs text-text-secondary leading-relaxed">{item.description}</p>
              </div>

              {item.unread && (
                <span className="w-2 h-2 rounded-full bg-accent-violet mt-2 shrink-0"></span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
