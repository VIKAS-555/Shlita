import React, { useState } from 'react';
import {
  Repeat,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  Pause,
  Play,
  ExternalLink,
  ShieldCheck,
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
          <h2 className="text-xl font-bold text-white tracking-tight">Recurring Subscriptions</h2>
          <p className="text-xs text-slate-400 mt-1">
            Autonomous periodic merchant commitments managed via the official Solana Subscriptions program.
          </p>
        </div>
        <div className="bg-card border border-border px-4 py-2 rounded-xl text-xs font-mono">
          <span className="text-slate-400">Total Monthly Commitment: </span>
          <span className="text-white font-bold">${totalMonthlyCommitment.toFixed(2)} USDC</span>
        </div>
      </div>

      {/* Subscriptions Table (Renewly Reference Layout) */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden glow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 border-b border-border font-mono text-[11px]">
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
                  className="hover:bg-slate-850/60 transition cursor-pointer group"
                >
                  <td className="py-3.5 px-4">
                    <div className="flex items-center space-x-3">
                      <div className="w-9 h-9 rounded-xl bg-slate-900 border border-border flex items-center justify-center text-base shadow-sm">
                        {sub.logo}
                      </div>
                      <div>
                        <div className="font-bold text-white group-hover:text-accent-violet transition">
                          {sub.name}
                        </div>
                        <div className="text-[10px] text-slate-400 font-sans">{sub.merchant}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-slate-300 font-bold">
                    ${sub.initialAmountUsdc.toFixed(2)} USDC
                  </td>
                  <td className="py-3.5 px-4 text-emerald-400 font-bold">
                    ${sub.amountUsdc.toFixed(2)} USDC
                  </td>
                  <td className="py-3.5 px-4 text-slate-300">
                    <span className="bg-slate-900 px-2 py-0.5 rounded border border-border/60">
                      {sub.billingInterval}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-slate-300">
                    <div className="flex items-center gap-1.5">
                      <Calendar size={12} className="text-slate-500" />
                      <span>{sub.nextCollectionDate}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-4">
                    {sub.status === 'ACTIVE' && (
                      <span className="inline-flex items-center gap-1 text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full text-[10px]">
                        <CheckCircle2 size={10} /> Active
                      </span>
                    )}
                    {sub.status === 'RETRY_PENDING' && (
                      <span className="inline-flex items-center gap-1 text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full text-[10px]">
                        <Clock size={10} /> Retry Pending
                      </span>
                    )}
                    {sub.status === 'PAST_DUE' && (
                      <span className="inline-flex items-center gap-1 text-red-400 bg-red-500/10 border border-red-500/30 px-2 py-0.5 rounded-full text-[10px]">
                        <AlertTriangle size={10} /> Past Due
                      </span>
                    )}
                    {sub.status === 'PAUSED' && (
                      <span className="inline-flex items-center gap-1 text-slate-400 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-full text-[10px]">
                        <Pause size={10} /> Paused
                      </span>
                    )}
                    {sub.status === 'CANCELLED' && (
                      <span className="inline-flex items-center gap-1 text-red-400 bg-red-950/40 border border-red-900/60 px-2 py-0.5 rounded-full text-[10px]">
                        <XCircle size={10} /> Cancelled
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <div className="inline-flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => onToggleSubscriptionPause(sub.id)}
                        className="text-xs bg-slate-800 hover:bg-slate-750 text-slate-300 border border-border px-2.5 py-1 rounded-lg transition"
                      >
                        {sub.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                      </button>
                      <button
                        onClick={() => onCancelSubscription(sub.id)}
                        className="text-xs bg-red-950/60 hover:bg-red-900 text-red-300 border border-red-900/80 px-2.5 py-1 rounded-lg transition"
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
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border w-full max-w-lg rounded-2xl p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center space-x-3">
                <span className="text-2xl">{selectedSub.logo}</span>
                <div>
                  <h3 className="font-bold text-white text-base">{selectedSub.name}</h3>
                  <span className="text-xs text-slate-400">{selectedSub.merchant}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedSub(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            {selectedSub.failureReason && (
              <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-xl text-xs text-amber-300">
                <strong>Failure Note:</strong> {selectedSub.failureReason}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-xs font-mono bg-slate-900 p-3 rounded-xl border border-border">
              <div>
                <span className="text-slate-400 block text-[10px]">MONTHLY RATE</span>
                <span className="font-bold text-white text-sm">${selectedSub.amountUsdc.toFixed(2)} USDC</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">NEXT CHARGE</span>
                <span className="font-bold text-white text-sm">{selectedSub.nextCollectionDate}</span>
              </div>
              <div className="col-span-2">
                <span className="text-slate-400 block text-[10px]">ON-CHAIN SUBSCRIPTION PDA</span>
                <span className="text-solana font-mono text-[11px] truncate block">{selectedSub.pdaAuthority}</span>
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-3 border-t border-border">
              <button
                onClick={() => setSelectedSub(null)}
                className="px-4 py-2 text-xs text-slate-300 hover:text-white transition"
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
