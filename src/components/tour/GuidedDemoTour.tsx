import React, { useState, useEffect } from 'react';
import {
  X,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  CheckCircle2,
  Play,
  Pause,
  Bot,
  ShieldCheck,
  Zap,
  Users,
  Terminal,
} from 'lucide-react';
import { ScreenId } from '../layout/Sidebar.js';
import { sounds } from '../../utils/audio.js';

interface TourStep {
  step: number;
  title: string;
  badge: string;
  icon: any;
  screen: ScreenId;
  description: string;
  callToAction: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    step: 1,
    title: 'Autonomous Financial Control Plane',
    badge: 'STAGE 1: COMMAND CENTER',
    icon: Zap,
    screen: 'overview',
    description:
      'Welcome to Shlita (שְׁלִיטָה). Explore the real-time Solana architecture node graph, 30-day budget velocity, and active PDA allowances protecting autonomous AI agents.',
    callToAction: 'View Live Architecture Flow',
  },
  {
    step: 2,
    title: 'Fleet Defense & In-Place Controls',
    badge: 'STAGE 2: FLEET CONTROLS',
    icon: Bot,
    screen: 'agents',
    description:
      '6 autonomous AI agents running in production. Click any agent to test the live daily budget slider, add/remove vendor whitelists, or engage the Master Emergency Freeze.',
    callToAction: 'Explore In-Place Controls',
  },
  {
    step: 3,
    title: 'Spending Policies & Circuit Breakers',
    badge: 'STAGE 3: 3-TIER ENFORCEMENT',
    icon: ShieldCheck,
    screen: 'policies',
    description:
      'Combines On-Chain Subscriptions PDA limits, Sub-ms Gateway reverse proxy rules, and rolling-frequency circuit breakers that auto-freeze agents during loop anomalies.',
    callToAction: 'Inspect 3-Tier Policy Guardrails',
  },
  {
    step: 4,
    title: 'Squads v4 Multi-Sig Governance',
    badge: 'STAGE 4: SQUADS CO-SIGNING',
    icon: Users,
    screen: 'policies',
    description:
      'High-value allowance revisions exceeding $500.00 USDC route directly to the Squads Multi-Sig Queue. Click "Review & Co-Sign" to test the 2/3 Ed25519 threshold simulator.',
    callToAction: 'Test Squads Multi-Sig Approval',
  },
  {
    step: 5,
    title: 'Live Web3 PDA Derivation & Telemetry',
    badge: 'STAGE 5: CRYPTOGRAPHY & LOGS',
    icon: Terminal,
    screen: 'api-sdk',
    description:
      'Inspect real-time non-custodial Program Derived Address derivation using @solana/web3.js (0.15ms latency), and expand the Live Telemetry drawer at the bottom right.',
    callToAction: 'Derive PDA & Inspect Telemetry',
  },
];

interface GuidedDemoTourProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateScreen: (screen: ScreenId) => void;
}

export const GuidedDemoTour: React.FC<GuidedDemoTourProps> = ({
  isOpen,
  onClose,
  onNavigateScreen,
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);

  const activeTourStep = TOUR_STEPS[currentStepIndex];

  // Sync screen when step changes
  useEffect(() => {
    if (isOpen && activeTourStep) {
      onNavigateScreen(activeTourStep.screen);
    }
  }, [currentStepIndex, isOpen]);

  // Auto-play timer (10 seconds per step)
  useEffect(() => {
    if (!isOpen || !isAutoPlaying) return;
    const interval = setInterval(() => {
      setCurrentStepIndex((prev) => {
        if (prev < TOUR_STEPS.length - 1) {
          sounds.playSuccess();
          return prev + 1;
        } else {
          setIsAutoPlaying(false);
          return prev;
        }
      });
    }, 9000);
    return () => clearInterval(interval);
  }, [isOpen, isAutoPlaying]);

  if (!isOpen) return null;

  const handleNext = () => {
    sounds.playClick();
    if (currentStepIndex < TOUR_STEPS.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
    } else {
      sounds.playSuccess();
      onClose();
    }
  };

  const handleBack = () => {
    sounds.playClick();
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };

  const IconComponent = activeTourStep.icon;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-[95vw] sm:w-[580px] font-mono text-xs animate-in slide-in-from-bottom-6 duration-300">
      <div className="bg-[#0C0E14]/95 backdrop-blur-2xl border border-solana/40 rounded-2xl p-5 shadow-2xl space-y-4 ring-1 ring-solana/30">
        {/* Tour Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-solana/15 text-solana">
              <IconComponent size={16} />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] text-solana font-bold tracking-wider">
                  {activeTourStep.badge}
                </span>
                <span className="text-text-muted text-[10px]">
                  ({currentStepIndex + 1} of {TOUR_STEPS.length})
                </span>
              </div>
              <h4 className="font-bold text-sm text-text-primary tracking-tight mt-0.5">
                {activeTourStep.title}
              </h4>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsAutoPlaying(!isAutoPlaying)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[10px] transition cursor-pointer font-bold ${
                isAutoPlaying
                  ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                  : 'bg-card-elevated text-text-muted border-border hover:text-text-primary'
              }`}
            >
              {isAutoPlaying ? <Pause size={11} /> : <Play size={11} />}
              <span>{isAutoPlaying ? 'Pause' : 'Auto'}</span>
            </button>
            <button
              onClick={() => {
                sounds.playClick();
                onClose();
              }}
              className="text-text-muted hover:text-text-primary p-1 rounded-lg hover:bg-border transition cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tour Step Description */}
        <p className="text-text-secondary text-xs leading-relaxed">
          {activeTourStep.description}
        </p>

        {/* Progress Bar & Navigation Controls */}
        <div className="pt-2 border-t border-border/80 flex items-center justify-between">
          {/* Progress dots */}
          <div className="flex items-center space-x-1.5">
            {TOUR_STEPS.map((s, idx) => (
              <button
                key={s.step}
                onClick={() => {
                  sounds.playClick();
                  setCurrentStepIndex(idx);
                }}
                className={`h-1.5 rounded-full transition-all cursor-pointer ${
                  currentStepIndex === idx
                    ? 'w-6 bg-solana'
                    : idx < currentStepIndex
                    ? 'w-2 bg-solana/50'
                    : 'w-2 bg-border'
                }`}
              />
            ))}
          </div>

          {/* Buttons */}
          <div className="flex items-center space-x-2">
            {currentStepIndex > 0 && (
              <button
                onClick={handleBack}
                className="flex items-center gap-1 bg-card-elevated hover:bg-border text-text-primary px-3 py-1.5 rounded-xl border border-border transition cursor-pointer text-xs"
              >
                <ArrowLeft size={13} />
                <span>Back</span>
              </button>
            )}
            <button
              onClick={handleNext}
              className="flex items-center gap-1.5 bg-gradient-to-r from-accent-violet to-solana-purple hover:opacity-95 text-white font-bold px-4 py-1.5 rounded-xl shadow-sm transition cursor-pointer text-xs"
            >
              <span>{currentStepIndex === TOUR_STEPS.length - 1 ? 'Finish Tour' : 'Next Stage'}</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
