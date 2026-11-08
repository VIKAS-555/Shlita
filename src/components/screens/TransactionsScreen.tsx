import React, { useState } from 'react';
import {
  Search,
  CheckCircle2,
  Clock,
  XCircle,
  ExternalLink,
  X,
  Copy,
  ShieldAlert,
} from 'lucide-react';
import { Transaction } from '../../types/dashboard.js';

interface TransactionsScreenProps {
  transactions: Transaction[];
  selectedTransaction: Transaction | null;
  onSelectTransaction: (tx: Transaction | null) => void;
}

export const TransactionsScreen: React.FC<TransactionsScreenProps> = ({
  transactions,
  selectedTransaction,
  onSelectTransaction,
}) => {
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedSig, setCopiedSig] = useState(false);

  const filtered = transactions.filter((tx) => {
    const matchesFilter = filterStatus === 'ALL' || tx.status === filterStatus;
    const matchesSearch =
      tx.signature.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tx.agentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tx.providerName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSig(true);
    setTimeout(() => setCopiedSig(false), 1500);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h2 className="text-xl font-bold text-text-primary tracking-tight">Transaction Activity Explorer</h2>
          <p className="text-xs text-text-muted mt-1">
            Complete audit trail of all confirmed on-chain payments and intercepted policy violations.
          </p>
        </div>
      </div>

      {/* Filter Pills & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-1.5 bg-card border border-border p-1 rounded-xl text-xs font-mono overflow-x-auto">
          {(['ALL', 'CONFIRMED', 'BLOCKED_BY_POLICY', 'PENDING', 'FAILED'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setFilterStatus(st)}
              className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition ${
                filterStatus === st
                  ? 'bg-accent-violet text-white font-semibold shadow-sm'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {st === 'ALL'
                ? 'All'
                : st === 'CONFIRMED'
                ? 'Success'
                : st === 'BLOCKED_BY_POLICY'
                ? 'Blocked'
                : st}
            </button>
          ))}
        </div>

        <div className="relative max-w-sm w-full">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search by signature, agent, or vendor..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-card border border-border focus:border-accent-violet rounded-xl pl-9 pr-4 py-1.5 text-xs text-text-primary placeholder-text-muted outline-none transition shadow-sm"
          />
        </div>
      </div>

      {/* Table View */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-card-elevated text-text-muted border-b border-border font-mono text-[11px]">
              <tr>
                <th className="py-3.5 px-4">TX HASH / SIGNATURE</th>
                <th className="py-3.5 px-4">STATUS</th>
                <th className="py-3.5 px-4">AGENT</th>
                <th className="py-3.5 px-4">PROVIDER</th>
                <th className="py-3.5 px-4">AMOUNT</th>
                <th className="py-3.5 px-4">NETWORK FEE</th>
                <th className="py-3.5 px-4 text-right">TIME</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 font-mono">
              {filtered.map((tx) => (
                <tr
                  key={tx.id}
                  onClick={() => onSelectTransaction(tx)}
                  className="hover:bg-card-elevated/60 transition cursor-pointer group"
                >
                  <td className="py-3.5 px-4">
                    <span className="font-semibold text-accent-violet hover:underline flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-solana"></span>
                      {tx.signature}
                    </span>
                  </td>
                  <td className="py-3.5 px-4">
                    {tx.status === 'CONFIRMED' && (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded-full text-[10px]">
                        <CheckCircle2 size={10} /> Success
                      </span>
                    )}
                    {tx.status === 'BLOCKED_BY_POLICY' && (
                      <span className="inline-flex items-center gap-1 text-red-500 bg-red-500/10 border border-red-500/25 px-2 py-0.5 rounded-full text-[10px]">
                        <ShieldAlert size={10} /> Blocked
                      </span>
                    )}
                    {tx.status === 'PENDING' && (
                      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 rounded-full text-[10px]">
                        <Clock size={10} /> Pending
                      </span>
                    )}
                    {tx.status === 'FAILED' && (
                      <span className="inline-flex items-center gap-1 text-red-500 bg-red-500/10 border border-red-500/25 px-2 py-0.5 rounded-full text-[10px]">
                        <XCircle size={10} /> Failed
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-text-primary">{tx.agentName}</td>
                  <td className="py-3.5 px-4 text-text-secondary">{tx.providerName}</td>
                  <td className="py-3.5 px-4 font-bold text-text-primary">
                    ${tx.amountUsdc.toFixed(tx.amountUsdc < 1 ? 3 : 2)} {tx.token}
                  </td>
                  <td className="py-3.5 px-4 text-text-muted text-[11px]">
                    {tx.networkFeeSol > 0 ? `${tx.networkFeeSol.toFixed(6)} SOL` : '0.00 SOL (Blocked)'}
                  </td>
                  <td className="py-3.5 px-4 text-right text-text-faint text-[11px]">
                    {tx.timestamp}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Transaction Slide-Over Drawer */}
      {selectedTransaction && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-lg bg-card border-l border-border h-full p-6 overflow-y-auto space-y-6 shadow-xl animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <div>
                <h3 className="font-bold text-text-primary text-base">Transaction Details</h3>
                <span className="text-xs text-text-muted font-mono">ID: {selectedTransaction.id}</span>
              </div>
              <button
                onClick={() => onSelectTransaction(null)}
                className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-card-elevated transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Status Callout */}
            <div
              className={`p-4 rounded-xl border space-y-2 ${
                selectedTransaction.status === 'CONFIRMED'
                  ? 'bg-emerald-500/10 border-emerald-500/25'
                  : selectedTransaction.status === 'BLOCKED_BY_POLICY'
                  ? 'bg-red-500/10 border-red-500/25'
                  : 'bg-amber-500/10 border-amber-500/25'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-mono font-bold">
                <span className="text-text-primary">STATUS: {selectedTransaction.status}</span>
                <span className="text-text-muted">{selectedTransaction.timestamp}</span>
              </div>
              {selectedTransaction.failureReason && (
                <p className="text-xs text-text-secondary font-sans mt-1 leading-relaxed">
                  <strong>Enforcement Verdict:</strong> {selectedTransaction.failureReason}
                </p>
              )}
            </div>

            {/* Signature & Solana Explorer */}
            <div className="space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted font-mono">
                Transaction Signature
              </span>
              <div className="bg-card-elevated p-3 rounded-xl border border-border flex items-center justify-between text-xs font-mono">
                <span className="text-accent-violet truncate">{selectedTransaction.signature}</span>
                <button
                  onClick={() => handleCopy(selectedTransaction.signature)}
                  className="p-1 text-text-muted hover:text-text-primary ml-2 transition"
                  title="Copy signature"
                >
                  <Copy size={14} />
                </button>
              </div>
              {selectedTransaction.status === 'CONFIRMED' && (
                <div className="flex items-center justify-between text-xs font-mono pt-1">
                  <span className="text-text-muted text-[10px]">
                    {selectedTransaction.signature.length >= 64 && !selectedTransaction.signature.includes('...')
                      ? 'Verified On-Chain Transaction'
                      : 'Client Sandbox Demo Record'}
                  </span>
                  {selectedTransaction.signature.length >= 64 && !selectedTransaction.signature.includes('...') ? (
                    <a
                      href={selectedTransaction.solanaExplorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-solana hover:underline font-mono"
                    >
                      <span>View on Solana Explorer</span>
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    <span className="text-amber-500/90 text-[11px] font-sans">
                      Sandbox Simulation (Explorer links active on live Devnet submission)
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Financial Ledger */}
            <div className="grid grid-cols-2 gap-3 text-xs font-mono bg-card-elevated p-3.5 rounded-xl border border-border">
              <div>
                <span className="text-text-muted block text-[10px]">TRANSFER AMOUNT</span>
                <span className="text-text-primary font-bold text-sm">
                  ${selectedTransaction.amountUsdc.toFixed(selectedTransaction.amountUsdc < 1 ? 3 : 2)} USDC
                </span>
              </div>
              <div>
                <span className="text-text-muted block text-[10px]">NETWORK FEE</span>
                <span className="text-text-secondary font-bold text-sm">
                  {selectedTransaction.networkFeeSol.toFixed(6)} SOL
                </span>
              </div>
              <div className="col-span-2 pt-2 border-t border-border/60">
                <span className="text-text-muted block text-[10px]">POLICY APPLIED</span>
                <span className="text-accent-violet font-semibold">{selectedTransaction.policyUsed}</span>
              </div>
            </div>

            {/* Addresses */}
            <div className="space-y-3 text-xs font-mono">
              <div>
                <span className="text-text-muted block text-[10px]">SENDER (AGENT PDA)</span>
                <span className="text-text-secondary bg-card-elevated px-3 py-1.5 rounded-lg border border-border block truncate">
                  {selectedTransaction.fromAddress}
                </span>
              </div>
              <div>
                <span className="text-text-muted block text-[10px]">RECEIVER (VENDOR ATA)</span>
                <span className="text-text-secondary bg-card-elevated px-3 py-1.5 rounded-lg border border-border block truncate">
                  {selectedTransaction.toAddress}
                </span>
              </div>
            </div>

            {/* Webhook Dispatch Log */}
            <div className="bg-card-elevated p-3 rounded-xl border border-border space-y-1 text-xs font-mono">
              <span className="text-text-muted text-[10px] block">WEBHOOK EVENT</span>
              <div className="text-emerald-600 dark:text-emerald-400">event: "transaction.{selectedTransaction.status.toLowerCase()}"</div>
              <div className="text-text-muted text-[11px]">Dispatched to https://api.trion.org/webhooks/shlita</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
