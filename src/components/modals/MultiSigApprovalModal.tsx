import React, { useState } from 'react';
import {
  X,
  ShieldCheck,
  CheckCircle2,
  Key,
  Users,
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { PendingApproval } from '../../types/dashboard.js';

interface MultiSigApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  approvalItem?: PendingApproval | null;
  onConfirmApproval: (item: {
    id: string;
    agentName: string;
    amountUsdc: number;
    provider: string;
  }) => void;
}

export const MultiSigApprovalModal: React.FC<MultiSigApprovalModalProps> = ({
  isOpen,
  onClose,
  approvalItem,
  onConfirmApproval,
}) => {
  const [signer2Signed, setSigner2Signed] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  if (!isOpen) return null;

  const currentItem = approvalItem || {
    id: 'appr-101',
    agentId: 'agent-research-01',
    agentName: 'research-agent-01',
    amountUsdc: 6200.0,
    provider: 'Helius RPC & Bulk Data Export',
    reason: 'Monthly allowance expansion for deep Solana ledger indexing & archival queries',
    requestedBy: 'research-agent-01 (Automated Request)',
    timestamp: '12 min ago',
    requiredSignatures: 2,
    currentSignatures: 1,
  };

  const handleSimulateCoSign = async () => {
    setIsSigning(true);
    await new Promise((r) => setTimeout(r, 600));
    setSigner2Signed(true);
    setIsSigning(false);

    // Auto-confirm after threshold is reached
    await new Promise((r) => setTimeout(r, 400));
    setConfirmed(true);

    onConfirmApproval({
      id: currentItem.id,
      agentName: currentItem.agentName,
      amountUsdc: currentItem.amountUsdc,
      provider: currentItem.provider,
    });
  };

  const handleResetAndClose = () => {
    setSigner2Signed(false);
    setConfirmed(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-card border border-border w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card-elevated">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-accent-violet/10 text-accent-violet border border-accent-violet/20">
              <ShieldCheck size={18} />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-sm text-text-primary tracking-tight">
                  Squads Multi-Sig Governance Seam
                </h3>
                <span className="text-[10px] bg-accent-violet/15 text-accent-violet font-mono px-2 py-0.5 rounded-full font-bold">
                  2 OF 3 THRESHOLD
                </span>
              </div>
              <p className="text-[11px] text-text-muted mt-0.5">
                Co-signature required for agent allowance requests exceeding $500.00 USDC.
              </p>
            </div>
          </div>
          <button
            onClick={handleResetAndClose}
            className="text-text-muted hover:text-text-primary p-1 rounded-lg hover:bg-border transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-xs font-mono">
          {/* Transaction Metadata Card */}
          <div className="p-4 bg-card-elevated border border-border rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-text-muted text-[11px]">TRANSACTION REQUEST ({currentItem.id})</span>
              <span className="text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full font-bold text-[10px]">
                PENDING SQUADS APPROVAL
              </span>
            </div>
            <div className="text-2xl font-extrabold text-text-primary mt-1">
              ${currentItem.amountUsdc.toLocaleString('en-US', { minimumFractionDigits: 2 })}{' '}
              <span className="text-xs text-text-muted font-normal">USDC</span>
            </div>
            <p className="text-[11px] text-text-secondary pt-1 leading-relaxed">
              {currentItem.reason}
            </p>
            <div className="grid grid-cols-2 gap-2 text-[11px] pt-2 border-t border-border/60">
              <div>
                <span className="text-text-muted block">Initiator Agent:</span>
                <span className="text-text-primary font-bold">{currentItem.agentName}</span>
              </div>
              <div>
                <span className="text-text-muted block">Target Provider:</span>
                <span className="text-cyan-300 font-bold">{currentItem.provider}</span>
              </div>
            </div>
          </div>

          {/* Co-Signers Threshold Progress */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-text-muted uppercase tracking-wider">Co-Signer Signatures</span>
              <span className="font-bold text-solana">
                {signer2Signed ? '2 / 3 Signatures Collected (Threshold Met ✔)' : '1 / 3 Signatures Collected'}
              </span>
            </div>

            {/* Signer 1: Primary Owner */}
            <div className="p-3 bg-emerald-500/5 border border-emerald-500/25 rounded-xl flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center font-bold text-xs">
                  AP
                </div>
                <div>
                  <div className="font-bold text-text-primary">Arnav Patel (XiaoArnav)</div>
                  <div className="text-[10px] text-text-muted">Owner / Primary Signer • Ed25519 Hash Validated</div>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-emerald-400 font-bold text-[10px] bg-emerald-500/15 px-2 py-1 rounded-lg">
                <CheckCircle2 size={12} />
                SIGNED
              </span>
            </div>

            {/* Signer 2: DevOps Lead */}
            <div
              className={`p-3 rounded-xl border transition flex items-center justify-between ${
                signer2Signed
                  ? 'bg-emerald-500/5 border-emerald-500/25'
                  : 'bg-card-elevated border-border'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className="w-7 h-7 rounded-lg bg-accent-violet/15 text-accent-violet flex items-center justify-center font-bold text-xs">
                  JD
                </div>
                <div>
                  <div className="font-bold text-text-primary">Jesse (Lead DevOps)</div>
                  <div className="text-[10px] text-text-muted">
                    {signer2Signed ? 'Co-Signature Validated on Solana Subscriptions Seam' : 'Required for 2/3 Multi-Sig Threshold'}
                  </div>
                </div>
              </div>

              {signer2Signed ? (
                <span className="inline-flex items-center gap-1 text-emerald-400 font-bold text-[10px] bg-emerald-500/15 px-2 py-1 rounded-lg">
                  <CheckCircle2 size={12} />
                  SIGNED
                </span>
              ) : (
                <button
                  disabled={isSigning}
                  onClick={handleSimulateCoSign}
                  className="bg-accent-violet hover:bg-accent-violet/90 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isSigning ? 'Signing...' : 'Simulate Co-Sign'}
                </button>
              )}
            </div>

            {/* Signer 3: Cold Vault */}
            <div className="p-3 bg-card-elevated/40 border border-border/60 rounded-xl flex items-center justify-between opacity-60">
              <div className="flex items-center space-x-3">
                <div className="w-7 h-7 rounded-lg bg-border text-text-muted flex items-center justify-center font-bold text-xs">
                  CV
                </div>
                <div>
                  <div className="font-bold text-text-muted">Cold Vault Signer</div>
                  <div className="text-[10px] text-text-faint">Squads Multi-Sig Vault (Offline Key)</div>
                </div>
              </div>
              <span className="text-[10px] text-text-faint bg-border px-2 py-1 rounded-lg">
                OPTIONAL (2/3 MET)
              </span>
            </div>
          </div>

          {confirmed && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 size={16} />
              <span>Multi-Sig Threshold Approved! Batch Settlement Dispatched to Solana Subscriptions PDA.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-card-elevated">
          <div className="text-[11px] font-mono text-text-muted">
            Squads v4 Program ID: <span className="text-text-primary">SQDS4...88xK</span>
          </div>
          <button
            onClick={handleResetAndClose}
            className="bg-card-elevated hover:bg-border text-text-primary border border-border text-xs font-semibold px-4 py-2 rounded-xl transition cursor-pointer"
          >
            {confirmed ? 'Close & View Ledger' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
};
