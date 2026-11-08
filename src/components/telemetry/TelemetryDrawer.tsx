import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  ChevronUp,
  ChevronDown,
  X,
  Play,
  Pause,
  Trash2,
  Copy,
  Check,
  Search,
  Activity,
  Zap,
} from 'lucide-react';

export interface TelemetryEvent {
  id: string;
  timestamp: string;
  type: 'APPROVED' | 'BLOCKED' | 'CIRCUIT' | 'SETTLED' | 'MULTISIG';
  statusCode: number;
  agent: string;
  vendor: string;
  amountUsdc: number;
  latencyMs: number;
  signature?: string;
  details?: Record<string, any>;
}

interface TelemetryDrawerProps {
  events: TelemetryEvent[];
  onClearEvents: () => void;
}

export const TelemetryDrawer: React.FC<TelemetryDrawerProps> = ({
  events,
  onClearEvents,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(true);
  const [filterType, setFilterType] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when new events arrive and streaming is active
  useEffect(() => {
    if (isOpen && isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, isOpen, isStreaming]);

  const filteredEvents = events.filter((ev) => {
    const matchesFilter = filterType === 'ALL' || ev.type === filterType;
    const matchesSearch =
      !searchQuery ||
      ev.agent.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ev.vendor.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ev.type.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const handleCopyJson = (ev: TelemetryEvent) => {
    navigator.clipboard.writeText(JSON.stringify(ev, null, 2));
    setCopiedId(ev.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end font-mono text-xs">
      {/* Floating Toggle Capsule */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center space-x-2.5 bg-[#0C0E14] hover:bg-[#141721] text-text-primary border border-border hover:border-solana/50 px-4 py-2.5 rounded-full shadow-2xl transition cursor-pointer group"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-solana opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-solana"></span>
          </span>
          <Terminal size={14} className="text-solana" />
          <span className="font-semibold text-xs tracking-tight">Live Telemetry</span>
          <span className="text-[10px] bg-accent-violet/20 text-accent-violet px-2 py-0.5 rounded-full font-bold">
            {events.length} logs
          </span>
          <ChevronUp size={14} className="text-text-muted group-hover:text-text-primary transition" />
        </button>
      )}

      {/* Expanded Slide-Up Terminal Console */}
      {isOpen && (
        <div className="w-[95vw] sm:w-[680px] bg-[#0A0C12]/95 backdrop-blur-2xl border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-bottom-5 duration-200">
          {/* Terminal Title Bar */}
          <div className="flex items-center justify-between px-4 py-3 bg-[#11141E] border-b border-border/80">
            <div className="flex items-center space-x-3">
              <span className="relative flex h-2 w-2">
                <span
                  className={`inline-flex rounded-full h-2 w-2 ${
                    isStreaming ? 'bg-solana animate-ping' : 'bg-amber-400'
                  }`}
                ></span>
              </span>
              <div className="flex items-center space-x-2">
                <Terminal size={14} className="text-solana" />
                <span className="font-bold text-xs text-text-primary tracking-wide">
                  SHLITA LIVE TELEMETRY STREAM
                </span>
              </div>
              <span className="text-[10px] bg-card px-2 py-0.5 rounded border border-border text-text-muted">
                {filteredEvents.length} events
              </span>
            </div>

            <div className="flex items-center space-x-1.5">
              <button
                onClick={() => setIsStreaming(!isStreaming)}
                className={`p-1.5 rounded-lg border text-[11px] flex items-center gap-1 transition ${
                  isStreaming
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-card border-border text-text-muted'
                }`}
                title={isStreaming ? 'Pause Stream' : 'Resume Stream'}
              >
                {isStreaming ? <Pause size={12} /> : <Play size={12} />}
                <span className="text-[10px] hidden sm:inline">{isStreaming ? 'Live' : 'Paused'}</span>
              </button>

              <button
                onClick={onClearEvents}
                className="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-card border border-transparent hover:border-border transition"
                title="Clear Logs"
              >
                <Trash2 size={13} />
              </button>

              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-card border border-transparent hover:border-border transition"
                title="Minimize Terminal"
              >
                <ChevronDown size={14} />
              </button>
            </div>
          </div>

          {/* Filter & Search Strip */}
          <div className="px-4 py-2 bg-[#0F121B] border-b border-border/60 flex items-center justify-between gap-2 text-[11px]">
            <div className="flex items-center space-x-1 overflow-x-auto">
              {(['ALL', 'APPROVED', 'BLOCKED', 'CIRCUIT', 'MULTISIG'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`px-2 py-0.5 rounded transition ${
                    filterType === t
                      ? 'bg-accent-violet text-white font-semibold'
                      : 'text-text-muted hover:text-text-primary hover:bg-card'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="relative w-40 sm:w-48">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                placeholder="Filter agent/vendor..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#161A26] border border-border/80 rounded-lg pl-7 pr-2 py-1 text-[10px] text-text-primary outline-none focus:border-accent-violet"
              />
            </div>
          </div>

          {/* Events Log Stream Container */}
          <div
            ref={scrollRef}
            className="h-64 overflow-y-auto p-3 space-y-1.5 text-[11px] leading-relaxed select-text"
          >
            {filteredEvents.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-text-muted space-y-1.5 text-xs">
                <Activity size={20} className="text-text-faint animate-pulse" />
                <span>Waiting for outbound agent telemetry...</span>
                <span className="text-[10px] text-text-faint">
                  Run the Simulator or trigger an API request to see real-time streaming.
                </span>
              </div>
            ) : (
              filteredEvents.map((ev) => {
                const isExpanded = expandedId === ev.id;
                return (
                  <div
                    key={ev.id}
                    className="bg-[#121520] hover:bg-[#161B29] border border-border/60 rounded-xl p-2.5 transition flex flex-col space-y-1.5"
                  >
                    <div
                      className="flex items-center justify-between cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : ev.id)}
                    >
                      <div className="flex items-center space-x-2 truncate">
                        <span className="text-text-faint text-[10px]">{ev.timestamp}</span>

                        {ev.type === 'APPROVED' && (
                          <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.2 rounded text-[10px] font-bold">
                            200 OK
                          </span>
                        )}
                        {ev.type === 'BLOCKED' && (
                          <span className="bg-red-500/15 text-red-400 border border-red-500/30 px-1.5 py-0.2 rounded text-[10px] font-bold">
                            403 BLOCKED
                          </span>
                        )}
                        {ev.type === 'CIRCUIT' && (
                          <span className="bg-solana/15 text-solana border border-solana/30 px-1.5 py-0.2 rounded text-[10px] font-bold animate-pulse">
                            CIRCUIT TRIPPED
                          </span>
                        )}
                        {ev.type === 'MULTISIG' && (
                          <span className="bg-accent-violet/20 text-accent-violet border border-accent-violet/30 px-1.5 py-0.2 rounded text-[10px] font-bold">
                            MULTISIG CO-SIGNED
                          </span>
                        )}

                        <span className="text-text-primary font-semibold truncate">{ev.agent}</span>
                        <span className="text-text-faint">→</span>
                        <span className="text-cyan-300 truncate">{ev.vendor}</span>
                      </div>

                      <div className="flex items-center space-x-2 shrink-0 ml-2">
                        <span className="text-text-muted font-bold">${ev.amountUsdc.toFixed(2)}</span>
                        <span className="text-text-faint text-[10px]">{ev.latencyMs}ms</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyJson(ev);
                          }}
                          className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-card transition"
                          title="Copy Event JSON"
                        >
                          {copiedId === ev.id ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                        </button>
                      </div>
                    </div>

                    {/* Expandable JSON Detail Payload */}
                    {isExpanded && (
                      <div className="mt-1.5 pt-2 border-t border-border/40 text-[10px] text-text-muted bg-[#0B0D14] p-2.5 rounded-lg overflow-x-auto space-y-1">
                        <div>
                          SIGNATURE:{' '}
                          <span className="text-solana">{ev.signature || 'N/A (Intercepted Pre-Execution)'}</span>
                        </div>
                        {ev.details && (
                          <pre className="text-text-secondary overflow-x-auto">
                            {JSON.stringify(ev.details, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Bar */}
          <div className="px-4 py-2 bg-[#0E111A] border-t border-border/60 flex items-center justify-between text-[10px] text-text-muted">
            <span className="flex items-center gap-1.5">
              <Zap size={11} className="text-solana" />
              <span>Gateway Engine: Sub-millisecond policy check (&lt; 0.5ms)</span>
            </span>
            <span className="text-text-faint font-mono">Port 4000 • Hono Gateway</span>
          </div>
        </div>
      )}
    </div>
  );
};
