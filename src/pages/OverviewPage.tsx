import React, { useEffect, useState } from 'react';
import { useTerminal } from '../context/TerminalContext.tsx';
import { SignalEntity } from '../types.ts';
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Award,
  BarChart3,
  CheckCircle2,
  Clock,
  Compass,
  Flame,
  Layers,
  Percent,
  Radio,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';

export const OverviewPage: React.FC = () => {
  const { snapshot, currentPrice, spread, activeSymbol, setActiveTab, t } = useTerminal();
  const [openSignals, setOpenSignals] = useState<SignalEntity[]>([]);
  const [recentClosedSignals, setRecentClosedSignals] = useState<SignalEntity[]>([]);
  const [statsSummary, setStatsSummary] = useState<any>(null);

  useEffect(() => {
    const fetchOverviewData = async () => {
      try {
        const [resOpen, resAll, resStats] = await Promise.all([
          fetch('/api/signals/history/open'),
          fetch('/api/signals?limit=10'),
          fetch('/api/signals/history/stats'),
        ]);

        const dataOpen = await resOpen.json();
        if (dataOpen.success) {
          setOpenSignals(dataOpen.openSignals || []);
        }

        const dataAll = await resAll.json();
        if (dataAll.success) {
          const closed = (dataAll.signals || []).filter(
            (s: SignalEntity) => s.outcome && s.outcome.status !== 'PENDING' && s.outcome.status !== 'TRIGGERED' && s.outcome.status !== 'TP1_HIT' && s.outcome.status !== 'TP2_HIT'
          );
          setRecentClosedSignals(closed.slice(0, 5));
        }

        const dataStats = await resStats.json();
        if (dataStats.success) {
          setStatsSummary(dataStats.summary);
        }
      } catch (e) {
        console.warn('Failed to load overview data:', e);
      }
    };

    fetchOverviewData();
    const interval = setInterval(fetchOverviewData, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex-1 bg-[#06080c] p-4 lg:p-6 space-y-6 overflow-y-auto select-none font-mono text-slate-200">
      {/* Top Hero Banner */}
      <div className="bg-gradient-to-r from-[#0b0f17] via-[#101623] to-[#0b0f17] border border-white/[0.08] rounded-2xl p-5 shadow-2xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-[#F5C451] font-bold tracking-wider uppercase">
              {t('quant_terminal', 'INSTITUTIONAL QUANTITATIVE SYSTEM', 'ប្រព័ន្ធវិភាគកម្រិតខ្ពស់')}
            </span>
          </div>
          <h1 className="text-xl lg:text-2xl font-bold text-slate-100">
            Smart Money Concepts & Real-Time Tracking Engine
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Multi-timeframe bias validation, algorithmic order block & liquidity sweeps with automated live trade tracking and cryptographic history.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setActiveTab('signals')}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#F5C451] hover:bg-[#e0b03e] text-black font-bold text-xs shadow-lg shadow-[#F5C451]/20 transition-all"
          >
            <span>Open History Terminal</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* TODAY / ALL-TIME STATS STRIP */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-[#0b0f17] border border-white/[0.08] rounded-xl p-3 shadow-lg">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Overall Win Rate</span>
            <Percent className="w-3.5 h-3.5 text-[#F5C451]" />
          </div>
          <div className="mt-2 text-xl font-black text-emerald-400">
            {statsSummary?.isSampleSufficient ? `${statsSummary.winRate}%` : 'Raw: ' + (statsSummary?.wins || 0) + 'W'}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Wilson CI: [{statsSummary?.wilsonInterval?.[0] || 0}%, {statsSummary?.wilsonInterval?.[1] || 0}%]
          </div>
        </div>

        <div className="bg-[#0b0f17] border border-white/[0.08] rounded-xl p-3 shadow-lg">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Expectancy</span>
            <Flame className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="mt-2 text-xl font-black text-slate-100">
            {statsSummary?.expectancyR >= 0 ? '+' : ''}{statsSummary?.expectancyR ?? 0}R
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Profit Factor: <span className="font-bold text-slate-200">{statsSummary?.profitFactor || 0}</span>
          </div>
        </div>

        <div className="bg-[#0b0f17] border border-white/[0.08] rounded-xl p-3 shadow-lg">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>TP1 Target Rate</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="mt-2 text-xl font-black text-cyan-400">
            {statsSummary?.tp1HitRate || 0}%
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Fill Rate: {statsSummary?.fillRate || 0}%
          </div>
        </div>

        <div className="bg-[#0b0f17] border border-white/[0.08] rounded-xl p-3 shadow-lg">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>SL Hit Before TP1</span>
            <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className="mt-2 text-xl font-black text-rose-400">
            {statsSummary?.slHitRate || 0}%
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Max Drawdown: -{statsSummary?.maxDrawdownR || 0}R
          </div>
        </div>
      </div>

      {/* OPEN SIGNALS LIVE TRACKING CARDS */}
      <div className="bg-[#0b0f17] border border-white/[0.08] rounded-2xl p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
            <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider">
              Live Open Signals & Spread-Aware Progress ({openSignals.length})
            </h2>
          </div>
          <span className="text-[11px] text-slate-400">
            Real-time TradingView feed tick updates
          </span>
        </div>

        {openSignals.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 bg-black/30 rounded-xl border border-white/[0.04]">
            No open signals currently running. Awaiting new high-confluence algorithmic setup.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {openSignals.map((sig) => {
              const outcome = sig.outcome;
              const isBuy = sig.direction === 'BUY';
              const fill = outcome?.fillPrice || sig.entryPrice;
              const risk = Math.abs(fill - sig.sl);
              const liveR = risk > 0
                ? isBuy
                  ? Number(((currentPrice - fill) / risk).toFixed(2))
                  : Number(((fill - currentPrice) / risk).toFixed(2))
                : 0;

              // Progress percentage: from SL (0%) through Entry (33%) to TP1 (100%)
              const range = Math.abs(sig.tp1 - sig.sl);
              const curDist = isBuy ? currentPrice - sig.sl : sig.sl - currentPrice;
              const progressPct = range > 0 ? Math.min(100, Math.max(0, (curDist / range) * 100)) : 50;

              return (
                <div
                  key={sig.id}
                  className="bg-black/40 border border-white/[0.06] rounded-xl p-4 space-y-3 relative overflow-hidden"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold ${
                          isBuy
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        {sig.direction} {sig.symbol}
                      </span>
                      <span className="text-xs text-slate-400">({sig.triggerTf})</span>
                      <span className="text-[10px] text-slate-500 font-bold">Grade {sig.grade}</span>
                    </div>

                    <div className="text-right">
                      <span
                        className={`font-black text-sm ${
                          liveR >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {liveR >= 0 ? '+' : ''}{liveR}R
                      </span>
                      <span className="text-[10px] text-slate-500 block">Live MFE: +{(outcome?.rMaxMfe ?? 0).toFixed(2)}R</span>
                    </div>
                  </div>

                  {/* Progress Bar (SL <- Entry -> TP1) */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                      <span className="text-rose-400">SL: ${sig.sl.toFixed(2)}</span>
                      <span className="text-slate-200">Fill: ${fill.toFixed(2)}</span>
                      <span className="text-emerald-400">TP1: ${sig.tp1.toFixed(2)}</span>
                    </div>

                    <div className="w-full h-2.5 bg-white/[0.04] rounded-full overflow-hidden relative border border-white/[0.08]">
                      {/* Entry line marker */}
                      <div className="absolute top-0 bottom-0 w-0.5 bg-white/40 left-[35%] z-10" />
                      {/* Progress fill */}
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          liveR >= 0 ? 'bg-gradient-to-r from-emerald-600 to-emerald-400' : 'bg-rose-500'
                        }`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>

                    <div className="flex justify-between text-[9px] text-slate-500">
                      <span>Status: <strong className="text-slate-300">{outcome?.status}</strong></span>
                      <span>Quote: <strong className="text-[#F5C451]">${currentPrice.toFixed(2)}</strong></span>
                      <span>Spread: ${(spread || 0.35).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* RECENT 5 RESOLVED SIGNALS STRIP */}
      <div className="bg-[#0b0f17] border border-white/[0.08] rounded-2xl p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-purple-400" />
            <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider">
              Last 5 Closed Signals & Outcomes
            </h2>
          </div>
          <button
            onClick={() => setActiveTab('signals')}
            className="text-xs text-[#F5C451] hover:underline flex items-center gap-1"
          >
            <span>View All in History</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-black/40 text-[10px] uppercase text-slate-400 border-b border-white/[0.08]">
                <th className="p-3">Time</th>
                <th className="p-3">Direction</th>
                <th className="p-3">Fill Price</th>
                <th className="p-3">Exit Price</th>
                <th className="p-3">Outcome</th>
                <th className="p-3">Realized R</th>
                <th className="p-3 text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {recentClosedSignals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-500">
                    No closed signals yet.
                  </td>
                </tr>
              ) : (
                recentClosedSignals.map((s) => {
                  const r = s.outcome?.rFinal ?? (s.outcome?.status.startsWith('TP') ? s.rrPlanned : -1);
                  return (
                    <tr key={s.id} className="hover:bg-white/[0.02]">
                      <td className="p-3 text-slate-400">
                        {new Date(s.createdTs * 1000).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        })}
                      </td>
                      <td className="p-3 font-bold">
                        <span className={s.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}>
                          {s.direction}
                        </span>
                      </td>
                      <td className="p-3 text-slate-200">
                        ${(s.outcome?.fillPrice || s.entryPrice).toFixed(2)}
                      </td>
                      <td className="p-3 text-slate-200">
                        ${(s.outcome?.exitPriceEffective || s.sl).toFixed(2)}
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-white/10 text-slate-200">
                          {s.outcome?.status}
                        </span>
                      </td>
                      <td className="p-3 font-bold text-sm">
                        <span className={r >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {r >= 0 ? `+${r}` : r}R
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => setActiveTab('signals')}
                          className="text-[#F5C451] hover:underline text-xs"
                        >
                          Details →
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
