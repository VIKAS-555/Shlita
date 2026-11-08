import React, { useState } from 'react';
import {
  Repeat,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  Pause,
  Calendar,
} from 'lucide-react';
import { Subscription } from '../../types/dashboard.js';

interface SubscriptionsScreenProps {
  subscriptions: Subscription[];
  onToggleSubscriptionPause: (id: string) => void;
  onCancelSubscription: (id: string) => void;
}

export const SubscriptionsScreen: React.FC<SubscriptionsScreenProps> = ({
  subscriptions,
  onToggleSubscriptionPause,
  onCancelSubscription,
}) => {
  const [selectedSub, setSelectedSub] = useState<Subscription | null>(null);

  const totalMonthlyCommitment = subscriptions
    .filter((s) => s.status === 'ACTIVE' || s.status === 'RETRY_PENDING')
    .reduce((acc, curr) => acc + curr.amountUsdc, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h2 className="text-xl font-bold text-text-primary tracking-tight">Recurring Subscriptions</h2>
          <p className="text-xs text-text-muted mt-1">
            Autonomous periodic merchant commitments managed via the official Solana Subscriptions program.
          </p>
        </div>
        <div className="bg-card border border-border px-4 py-2 rounded-xl text-xs font-mono shadow-sm">
          <span className="text-text-muted">Total Monthly Commitment: </span>
          <span className="text-text-primary font-bold">${totalMonthlyCommitment.toFixed(2)} USDC</span>
        </div>
      </div>

      {/* Subscriptions Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-card-elevated text-text-muted border-b border-border font-mono text-[11px]">
              <tr>
                <th className="py-3.5 px-4">SERVICE & MERCHANT</th>
                <th className="py-3.5 px-4">INITIAL AMOUNT</th>
                <th className="py-3.5 px-4">RECURRING COMMITMENT</th>
                <th className="py-3.5 px-4">INTERVAL</th>
                <th className="py-3.5 px-4">NEXT COLLECTION</th>
                <th className="py-3.5 px-4">STATUS</th>
                <th className="py-3.5 px-4 text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 font-mono">
              {subscriptions.map((sub) => (
                <tr
                  key={sub.id}
                  onClick={() => setSelectedSub(sub)}
                  className="hover:bg-card-elevated/60 transition cursor-pointer group"
                >
                  <td className="py-3.5 px-4">
                    <div className="flex items-center space-x-3">
                      <div className="w-9 h-9 rounded-xl bg-card-elevated border border-border flex items-center justify-center text-base shadow-sm">
                        {sub.logo}
                      </div>
                      <div>
                        <div className="font-semibold text-text-primary group-hover:text-accent-violet transition">
                          {sub.name}
                        </div>
                        <div className="text-[10px] text-text-muted font-sans">{sub.merchant}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-text-secondary font-bold">
                    ${sub.initialAmountUsdc.toFixed(2)} USDC
                  </td>
                  <td className="py-3.5 px-4 text-emerald-600 dark:text-emerald-400 font-bold">
                    ${sub.amountUsdc.toFixed(2)} USDC
                  </td>
                  <td className="py-3.5 px-4 text-text-secondary">
                    <span className="bg-card-elevated px-2 py-0.5 rounded border border-border">
                      {sub.billingInterval}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-text-secondary">
                    <div className="flex items-center gap-1.5">
                      <Calendar size={12} className="text-text-muted" />
                      <span>{sub.nextCollectionDate}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-4">
                    {sub.status === 'ACTIVE' && (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded-full text-[10px]">
                        <CheckCircle2 size={10} /> Active
                      </span>
                    )}
                    {sub.status === 'RETRY_PENDING' && (
                      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 rounded-full text-[10px]">
                        <Clock size={10} /> Retry Pending
                      </span>
                    )}
                    {sub.status === 'PAST_DUE' && (
                      <span className="inline-flex items-center gap-1 text-red-500 bg-red-500/10 border border-red-500/25 px-2 py-0.5 rounded-full text-[10px]">
                        <AlertTriangle size={10} /> Past Due
                      </span>
                    )}
                    {sub.status === 'PAUSED' && (
                      <span className="inline-flex items-center gap-1 text-text-muted bg-card-elevated border border-border px-2 py-0.5 rounded-full text-[10px]">
                        <Pause size={10} /> Paused
                      </span>
                    )}
                    {sub.status === 'CANCELLED' && (
                      <span className="inline-flex items-center gap-1 text-red-500 bg-red-500/10 border border-red-500/25 px-2 py-0.5 rounded-full text-[10px]">
                        <XCircle size={10} /> Cancelled
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <div className="inline-flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => onToggleSubscriptionPause(sub.id)}
                        className="text-xs bg-card-elevated hover:bg-border text-text-secondary border border-border px-2.5 py-1 rounded-lg transition"
                      >
                        {sub.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                      </button>
                      <button
                        onClick={() => onCancelSubscription(sub.id)}
                        className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/25 px-2.5 py-1 rounded-lg transition"
                      >
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Subscription Detail Modal */}
      {selectedSub && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border w-full max-w-lg rounded-2xl p-6 space-y-4 shadow-xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center space-x-3">
                <span className="text-2xl">{selectedSub.logo}</span>
                <div>
                  <h3 className="font-bold text-text-primary text-base">{selectedSub.name}</h3>
                  <span className="text-xs text-text-muted">{selectedSub.merchant}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedSub(null)}
                className="text-text-muted hover:text-text-primary p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            {selectedSub.failureReason && (
              <div className="bg-amber-500/10 border border-amber-500/25 p-3 rounded-xl text-xs text-amber-600 dark:text-amber-400">
                <strong>Failure Note:</strong> {selectedSub.failureReason}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-xs font-mono bg-card-elevated p-3 rounded-xl border border-border">
              <div>
                <span className="text-text-muted block text-[10px]">MONTHLY RATE</span>
                <span className="font-bold text-text-primary text-sm">${selectedSub.amountUsdc.toFixed(2)} USDC</span>
              </div>
              <div>
                <span className="text-text-muted block text-[10px]">NEXT CHARGE</span>
                <span className="font-bold text-text-primary text-sm">{selectedSub.nextCollectionDate}</span>
              </div>
              <div className="col-span-2">
                <span className="text-text-muted block text-[10px]">ON-CHAIN SUBSCRIPTION PDA</span>
                <span className="text-solana font-mono text-[11px] truncate block">{selectedSub.pdaAuthority}</span>
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-3 border-t border-border">
              <button
                onClick={() => setSelectedSub(null)}
                className="px-4 py-2 text-xs text-text-secondary hover:text-text-primary transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
