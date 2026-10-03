import React, { useEffect, useState } from 'react';
import {
  CompareTradeRecord,
  HistorySummaryStats,
  MyTradeEntity,
  SignalEntity,
  SignalEvent,
} from '../types.ts';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Award,
  BarChart2,
  Calendar,
  CheckCircle2,
  Clock,
  Compass,
  Download,
  ExternalLink,
  Eye,
  Filter,
  Flame,
  HelpCircle,
  Info,
  Layers,
  Lock,
  Percent,
  PlayCircle,
  PlusCircle,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  X,
  XCircle,
  Zap,
} from 'lucide-react';

const formatGatedPercent = (value: number | undefined, isSufficient: boolean | undefined, sampleCount: number | undefined) =>
  isSufficient ? `${value ?? 0}%` : `insufficient sample (n=${sampleCount ?? 0})`;

export const SignalsPage: React.FC = () => {
  const [activeView, setActiveView] = useState<'system' | 'my_trades' | 'compare' | 'source_compare'>('system');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'INDICATOR' | 'ANALYSIS' | 'CONFLUENCE'>('ALL');
  const [signals, setSignals] = useState<SignalEntity[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [summaryStats, setSummaryStats] = useState<HistorySummaryStats | null>(null);
  const [equityCurve, setEquityCurve] = useState<any[]>([]);
  const [rDistribution, setRDistribution] = useState<any[]>([]);
  const [mfeMaeScatter, setMfeMaeScatter] = useState<any[]>([]);
  const [segments, setSegments] = useState<any>(null);

  // My trades & compare state
  const [myTrades, setMyTrades] = useState<MyTradeEntity[]>([]);
  const [compareTrades, setCompareTrades] = useState<CompareTradeRecord[]>([]);
  const [sourceComparison, setSourceComparison] = useState<any>(null);

  // Filtering
  const [filterDirection, setFilterDirection] = useState<string>('ALL');
  const [filterGrade, setFilterGrade] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [analyticsTab, setAnalyticsTab] = useState<'equity' | 'distribution' | 'scatter' | 'calibration' | 'factors'>('equity');

  // Modals & Drawers
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [signalDetail, setSignalDetail] = useState<{
    signal: SignalEntity;
    events: SignalEvent[];
    notes?: string;
    tags?: string[];
  } | null>(null);
  const [takeTradeSignal, setTakeTradeSignal] = useState<SignalEntity | null>(null);
  const [takeForm, setTakeForm] = useState({
    actualEntry: '',
    actualSl: '',
    actualTp: '',
    lot: '0.10',
    notes: '',
  });

  const [verifyResult, setVerifyResult] = useState<{
    signalId: string;
    isValid: boolean;
    expectedHash: string;
    storedHash: string;
  } | null>(null);

  const [notesInput, setNotesInput] = useState<string>('');
  const [isSavingNotes, setIsSavingNotes] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Load signals, stats, and personal trades
  const loadData = async () => {
    setIsLoading(true);
    try {
      const [resSignals, resStats, resMyTrades, resCompare, resSourceComparison] = await Promise.all([
        fetch(`/api/signals?source=${sourceFilter}&origin=engine_live&limit=1000`),
        fetch(`/api/signals/history/stats?source=${sourceFilter}&origin=engine_live`),
        fetch('/api/my-trades'),
        fetch('/api/my-trades/compare'),
        fetch('/api/signals/history/source-compare'),
      ]);

      const dataSig = await resSignals.json();
      if (dataSig.success) {
        setSignals(dataSig.signals || []);
        setTotalCount(dataSig.total || 0);
      }

      const dataStats = await resStats.json();
      if (dataStats.success) {
        setSummaryStats(dataStats.summary);
        setEquityCurve(dataStats.equityCurve || []);
        setRDistribution(dataStats.rDistribution || []);
        setMfeMaeScatter(dataStats.mfeMaeScatter || []);
        setSegments(dataStats.segments || null);
      }

      const dataMy = await resMyTrades.json();
      if (dataMy.success) {
        setMyTrades(dataMy.trades || []);
      }

      const dataComp = await resCompare.json();
      if (dataComp.success) {
        setCompareTrades(dataComp.compare || []);
      }

      const sourceCompareData = await resSourceComparison.json();
      if (sourceCompareData.success) setSourceComparison(sourceCompareData);
    } catch (e) {
      console.warn('Failed to load history data:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [sourceFilter]);

  // Keep signal outcomes and history statistics current while this page stays open.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadData();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [sourceFilter]);

  // Open signal detail drawer
  const inspectSignal = async (id: string) => {
    setSelectedSignalId(id);
    try {
      const res = await fetch(`/api/signals/${id}`);
      const data = await res.json();
      if (data.success && data.signal) {
        setSignalDetail({
          signal: data.signal,
          events: data.signal.events || [],
          notes: data.signal.notes || '',
          tags: data.signal.tags || [],
        });
        setNotesInput(data.signal.notes || '');
      }
    } catch (e) {
      console.warn('Failed to fetch signal details:', e);
    }
  };

  // Verify cryptographic hash
  const verifyHash = async (id: string) => {
    try {
      const res = await fetch(`/api/signals/${id}/verify`);
      const data = await res.json();
      if (data.success) {
        setVerifyResult({
          signalId: id,
          isValid: data.isValid,
          expectedHash: data.expectedHash,
          storedHash: data.storedHash,
        });
      }
    } catch (e) {
      console.warn('Hash verification failed:', e);
    }
  };

  // Save personal notes
  const saveNotes = async () => {
    if (!selectedSignalId) return;
    setIsSavingNotes(true);
    try {
      await fetch(`/api/signals/${selectedSignalId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notesInput }),
      });
      if (signalDetail) {
        setSignalDetail({ ...signalDetail, notes: notesInput });
      }
    } catch (e) {
      console.warn('Failed to save notes:', e);
    } finally {
      setIsSavingNotes(false);
    }
  };

  // Submit "I took this" trade
  const submitMyTrade = async () => {
    if (!takeTradeSignal) return;
    try {
      await fetch('/api/my-trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signalId: takeTradeSignal.id,
          takenTs: Math.floor(Date.now() / 1000),
          symbol: takeTradeSignal.symbol,
          direction: takeTradeSignal.direction,
          actualEntry: parseFloat(takeForm.actualEntry) || takeTradeSignal.entryPrice,
          actualSl: parseFloat(takeForm.actualSl) || takeTradeSignal.sl,
          actualTp: parseFloat(takeForm.actualTp) || takeTradeSignal.tp1,
          lot: parseFloat(takeForm.lot) || 0.1,
          notes: takeForm.notes,
        }),
      });
      setTakeTradeSignal(null);
      loadData();
    } catch (e) {
      console.warn('Failed to record personal trade:', e);
    }
  };

  // Filter signals list
  const filteredSignals = signals.filter((s) => {
    if (filterDirection !== 'ALL' && s.direction !== filterDirection) return false;
    if (filterGrade !== 'ALL' && s.grade !== filterGrade) return false;
    if (filterStatus !== 'ALL') {
      const st = s.outcome?.status || 'PENDING';
      const isResolved = ['TP3_HIT', 'SL_HIT', 'BE_EXIT', 'TRAIL_EXIT', 'SL_AFTER_TP1', 'INVALIDATED', 'TIME_STOP'].includes(st)
        && Number.isFinite(s.outcome?.rFinal);
      if (filterStatus === 'RESOLVED' && !isResolved) return false;
      if (filterStatus === 'OPEN' && st !== 'PENDING' && st !== 'TRIGGERED' && st !== 'TP1_HIT' && st !== 'TP2_HIT') return false;
      if (filterStatus !== 'RESOLVED' && filterStatus !== 'OPEN' && st !== filterStatus) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchId = s.id.toLowerCase().includes(q);
      const matchHash = s.snapshotHash.toLowerCase().includes(q);
      const matchSession = s.session.toLowerCase().includes(q);
      const matchRegime = s.regime.toLowerCase().includes(q);
      const matchSymbol = s.symbol.toLowerCase().includes(q);
      const matchDirection = s.direction.toLowerCase().includes(q);
      if (!matchId && !matchHash && !matchSession && !matchRegime && !matchSymbol && !matchDirection) return false;
    }
    return true;
  });

  return (
    <div className="flex-1 bg-[#06080c] p-4 lg:p-6 space-y-6 overflow-y-auto font-mono select-none text-slate-200">
      {/* Top Header & View Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-bold text-[#F5C451] tracking-wider uppercase">
              100% EMPIRICAL · REAL-TIME OUTCOME TRACKING
            </span>
          </div>
          <h1 className="text-xl lg:text-2xl font-bold text-slate-100 flex items-center gap-2.5 mt-1">
            <span>Signal History & Performance Intelligence</span>
            <span className="px-2 py-0.5 rounded text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              SHA-256 Chain
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl leading-relaxed">
            Every algorithmic signal is recorded immutably at generation. Real-time spread-aware tracking measures exact fill prices, TP/SL hits, and Wilson confidence intervals without survivorship bias.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Live vs Replay source selector */}
          <div className="bg-[#0b0f17] p-1 rounded-lg border border-white/[0.08] flex items-center gap-1 text-xs">
            <button
              onClick={() => setSourceFilter('ALL')}
              className={`px-3 py-1.5 rounded-md font-semibold transition-all ${
                sourceFilter === 'ALL' ? 'bg-[#F5C451] text-black shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Signals
            </button>
            <button
              onClick={() => setSourceFilter('INDICATOR')}
              className={`px-3 py-1.5 rounded-md font-semibold transition-all flex items-center gap-1.5 ${
                sourceFilter === 'INDICATOR' ? 'bg-cyan-500 text-black shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
              Indicator
            </button>
            <button
              onClick={() => setSourceFilter('ANALYSIS')}
              className={`px-3 py-1.5 rounded-md font-semibold transition-all flex items-center gap-1.5 ${
                sourceFilter === 'ANALYSIS' ? 'bg-amber-500 text-black shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <PlayCircle className="w-3.5 h-3.5" />
              Analysis
            </button>
            <button
              onClick={() => setSourceFilter('CONFLUENCE')}
              className={`px-3 py-1.5 rounded-md font-semibold transition-all ${
                sourceFilter === 'CONFLUENCE' ? 'bg-emerald-500 text-black shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Confluence
            </button>
          </div>

          {/* Export buttons */}
          <a
            href="/api/signals/export/csv"
            download="signals_history.csv"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 text-xs border border-white/[0.08] transition-all"
            title="Export CSV of full history"
          >
            <Download className="w-3.5 h-3.5 text-[#F5C451]" />
            <span>CSV</span>
          </a>
          <a
            href="/api/signals/export/json"
            download="signals_history.json"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 text-xs border border-white/[0.08] transition-all"
            title="Export JSON of full history"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            <span>JSON</span>
          </a>

          <button
            onClick={loadData}
            disabled={isLoading}
            className="p-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-white/[0.08] transition-all"
            title="Refresh database"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#F5C451]' : ''}`} />
          </button>
        </div>
      </div>

      {/* Primary View Switcher Strip */}
      <div className="flex border-b border-white/[0.08] gap-4">
        <button
          onClick={() => setActiveView('system')}
          className={`pb-3 text-xs font-bold tracking-wider uppercase transition-all flex items-center gap-2 border-b-2 ${
            activeView === 'system'
              ? 'border-[#F5C451] text-[#F5C451]'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>System Signal History ({totalCount})</span>
        </button>

        <button
          onClick={() => setActiveView('my_trades')}
          className={`pb-3 text-xs font-bold tracking-wider uppercase transition-all flex items-center gap-2 border-b-2 ${
            activeView === 'my_trades'
              ? 'border-cyan-400 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Award className="w-4 h-4" />
          <span>My Actual Trades ({myTrades.length})</span>
        </button>

        <button
          onClick={() => setActiveView('compare')}
          className={`pb-3 text-xs font-bold tracking-wider uppercase transition-all flex items-center gap-2 border-b-2 ${
            activeView === 'compare'
              ? 'border-purple-400 text-purple-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Scale className="w-4 h-4" />
          <span>Execution Gap & Slippage ({compareTrades.length})</span>
        </button>
        <button
          onClick={() => setActiveView('source_compare')}
          className={`pb-3 text-xs font-bold tracking-wider uppercase transition-all flex items-center gap-2 border-b-2 ${
            activeView === 'source_compare'
              ? 'border-cyan-400 text-cyan-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Scale className="w-4 h-4" />
          <span>Source Compare</span>
        </button>
      </div>

      {/* SUMMARY PERFORMANCE STRIP (Rule 2: Minimum sample n < 30 displays warning badge) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Card 1: Win Rate & Sample Gate */}
        <div className="bg-[#0b0f17] border border-white/[0.08] rounded-xl p-3 shadow-lg relative overflow-hidden">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Win Rate (Wilson 95% CI)</span>
            <Percent className="w-3.5 h-3.5 text-[#F5C451]" />
          </div>

          <div className="mt-2 flex items-baseline gap-2">
            {summaryStats?.isSampleSufficient ? (
              <span className="text-xl lg:text-2xl font-black text-emerald-400">
                {summaryStats.winRate}%
              </span>
            ) : (
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20 block">
                  insufficient sample (n={summaryStats?.sampleCount || 0})
                </span>
                <span className="text-[10px] text-slate-400">
                  Raw: {summaryStats?.wins || 0}W · {summaryStats?.losses || 0}L · {summaryStats?.beCount || 0}BE
                </span>
              </div>
            )}
          </div>

          {summaryStats?.isSampleSufficient && (
            <div className="text-[10px] text-slate-400 mt-1">
              CI: [{summaryStats.wilsonInterval[0]}%, {summaryStats.wilsonInterval[1]}%] (n={summaryStats.sampleCount})
            </div>
          )}
        </div>

        {/* Card 2: Expectancy & Total R */}
        <div className="bg-[#0b0f17] border border-white/[0.08] rounded-xl p-3 shadow-lg">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Expectancy (R/trade)</span>
            <Flame className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`text-xl lg:text-2xl font-black ${
                (summaryStats?.expectancyR || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {(summaryStats?.expectancyR || 0) >= 0 ? '+' : ''}
              {summaryStats?.expectancyR ?? 0.0}R
            </span>
            <span className="text-[10px] text-slate-400">
              Avg: {(summaryStats?.avgR || 0) >= 0 ? '+' : ''}{summaryStats?.avgR ?? 0.0}R
            </span>
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Profit Factor: <span className="font-bold text-slate-200">{summaryStats?.profitFactor ?? 0}</span>
          </div>
        </div>

        {/* Card 3: TP Hit Rates */}
        <div className="bg-[#0b0f17] border border-white/[0.08] rounded-xl p-3 shadow-lg">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>TP Hit Rates</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1 text-center text-xs">
            <div className="bg-white/[0.03] p-1 rounded">
              <span className="text-[9px] text-slate-400 block">TP1</span>
              <span className="font-bold text-emerald-300">{formatGatedPercent(summaryStats?.tp1HitRate, summaryStats?.isSampleSufficient, summaryStats?.sampleCount)}</span>
            </div>
            <div className="bg-white/[0.03] p-1 rounded">
              <span className="text-[9px] text-slate-400 block">TP2</span>
              <span className="font-bold text-cyan-300">{formatGatedPercent(summaryStats?.tp2HitRate, summaryStats?.isSampleSufficient, summaryStats?.sampleCount)}</span>
            </div>
            <div className="bg-white/[0.03] p-1 rounded">
              <span className="text-[9px] text-slate-400 block">TP3</span>
              <span className="font-bold text-purple-300">{formatGatedPercent(summaryStats?.tp3HitRate, summaryStats?.isSampleSufficient, summaryStats?.sampleCount)}</span>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Fill Rate: <span className="font-bold text-slate-200">{formatGatedPercent(summaryStats?.fillRate, summaryStats?.isSampleSufficient, summaryStats?.sampleCount)}</span>
          </div>
        </div>

        {/* Card 4: Stop Loss Hit Rate */}
        <div className="bg-[#0b0f17] border border-white/[0.08] rounded-xl p-3 shadow-lg">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>SL Hit Before TP1</span>
            <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl lg:text-2xl font-black text-rose-400">
              {formatGatedPercent(summaryStats?.slHitRate, summaryStats?.isSampleSufficient, summaryStats?.sampleCount)}
            </span>
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Max Drawdown: <span className="text-rose-400 font-bold">-{summaryStats?.maxDrawdownR ?? 0}R</span>
          </div>
        </div>

        {/* Card 5: Duration & Streaks */}
        <div className="bg-[#0b0f17] border border-white/[0.08] rounded-xl p-3 shadow-lg">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Timing & Streaks</span>
            <Clock className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="mt-2 text-xs flex justify-between">
            <span className="text-slate-400">Avg to TP1:</span>
            <span className="font-bold text-slate-100">
              {summaryStats?.avgTimeToTp1 ? `${Math.round(summaryStats.avgTimeToTp1 / 60)}m` : 'N/A'}
            </span>
          </div>
          <div className="mt-1 text-xs flex justify-between">
            <span className="text-slate-400">Streaks:</span>
            <span className="font-bold text-emerald-400">{summaryStats?.longestWinStreak ?? 0}W</span>
            <span className="text-slate-500">/</span>
            <span className="font-bold text-rose-400">{summaryStats?.longestLossStreak ?? 0}L</span>
          </div>
        </div>

        {/* Card 6: Integrity & Verification */}
        <div className="bg-[#0b0f17] border border-white/[0.08] rounded-xl p-3 shadow-lg">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Integrity Status</span>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-400 font-bold">
            <Lock className="w-3.5 h-3.5" />
            <span>100% Immutable Chain</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Ambiguous: {summaryStats?.percentAmbiguous ?? 0}% · Reconstructed: {summaryStats?.percentReconstructed ?? 0}%
          </div>
        </div>
      </div>

      {activeView === 'source_compare' && sourceComparison && (
        <section className="space-y-4" aria-label="Signal source comparison">
          <div className="rounded-md border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs text-amber-200">
            Both streams share the same XAUUSD candles and ticks. Comparison is exploratory, not independent market evidence.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { key: 'INDICATOR', label: 'Indicator' },
              { key: 'ANALYSIS', label: 'Analysis' },
              { key: 'CONFLUENCE', label: 'Confluence · one Indicator outcome per group' },
            ].map(({ key, label }) => {
              const stats = sourceComparison.sources[key];
              return (
                <div key={key} className="bg-[#0b0f17] border border-white/[0.08] rounded-lg p-4 space-y-2">
                  <h2 className="text-xs font-bold uppercase text-slate-200">{label}</h2>
                  <div className="text-[11px] text-slate-400">Signals {stats.totalSignals} · resolved n={stats.sampleCount}</div>
                  <div className="text-sm font-bold text-[#F5C451]">
                    {stats.isSampleSufficient ? `${stats.winRate}% win rate` : `insufficient sample (n=${stats.sampleCount})`}
                  </div>
                  {stats.isSampleSufficient && <div className="text-[11px] text-slate-400">Wilson 95% CI [{stats.wilsonInterval[0]}%, {stats.wilsonInterval[1]}%]</div>}
                  <div className="text-[11px] text-slate-300">Expectancy {stats.expectancyR}R · PF {stats.profitFactor} · Max DD {stats.maxDrawdownR}R</div>
                </div>
              );
            })}
          </div>
          <div className="bg-[#0b0f17] border border-white/[0.08] rounded-lg p-4">
            <h2 className="text-xs font-bold uppercase text-slate-200 mb-3">Agreement matrix</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {Object.entries(sourceComparison.agreementMatrix).map(([key, stats]: [string, any]) => (
                <div key={key} className="border-l-2 border-cyan-500/40 pl-3">
                  <div className="text-[10px] text-slate-400">{key}</div>
                  <div className="text-xs font-bold text-slate-200">{stats.isSampleSufficient ? `${stats.winRate}%` : `insufficient sample (n=${stats.sampleCount})`}</div>
                  <div className="text-[10px] text-slate-500">Expectancy {stats.expectancyR}R</div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-[#0b0f17] border border-white/[0.08] rounded-lg p-4 text-xs">
            <h2 className="font-bold uppercase text-slate-200">Paired outcomes</h2>
            <p className="text-slate-400 mt-2">
              Analysis minus Indicator: {sourceComparison.paired.isSampleSufficient ? `${sourceComparison.paired.averageAnalysisMinusIndicatorR}R` : `insufficient sample (n=${sourceComparison.paired.sampleCount})`}
              {' '}· Bootstrap CI not available yet.
            </p>
          </div>
        </section>
      )}

      {/* VIEW: SYSTEM SIGNALS TABLE */}
      {activeView === 'system' && (
        <div className="space-y-4">
          {/* Table Toolbar & Filters */}
          <div className="bg-[#0b0f17] p-3 rounded-xl border border-white/[0.08] flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search ID, hash, session..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-black/40 border border-white/[0.08] rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#F5C451]"
                />
              </div>

              {/* Direction filter */}
              <select
                value={filterDirection}
                onChange={(e) => setFilterDirection(e.target.value)}
                className="bg-black/40 border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
              >
                <option value="ALL">Direction: All</option>
                <option value="BUY">BUY Only</option>
                <option value="SELL">SELL Only</option>
              </select>

              {/* Grade filter */}
              <select
                value={filterGrade}
                onChange={(e) => setFilterGrade(e.target.value)}
                className="bg-black/40 border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
              >
                <option value="ALL">Grade: All</option>
                <option value="A+">A+ Premium</option>
                <option value="A">A Institutional</option>
                <option value="B">B Strong</option>
                <option value="C">C Lean</option>
              </select>

              {/* Status filter */}
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-black/40 border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
              >
                <option value="ALL">Status: All</option>
                <option value="OPEN">Open (Active)</option>
                <option value="RESOLVED">Resolved (Closed)</option>
                <option value="TP1_HIT">TP1 Hit</option>
                <option value="TP2_HIT">TP2 Hit</option>
                <option value="TP3_HIT">TP3 Hit</option>
                <option value="SL_HIT">SL Hit</option>
                <option value="BE_EXIT">BE Exit</option>
                <option value="INVALIDATED">Invalidated</option>
              </select>
            </div>

            <div className="text-slate-400 text-xs">
              Showing <span className="font-bold text-slate-200">{filteredSignals.length}</span> of {totalCount} signals
            </div>
          </div>

          {/* Signals Table */}
          <div className="bg-[#0b0f17] border border-white/[0.08] rounded-xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-black/40 text-[10px] uppercase tracking-wider text-slate-400 border-b border-white/[0.08]">
                    <th className="p-3">Time & Symbol</th>
                    <th className="p-3">Direction</th>
                    <th className="p-3">Grade & Score</th>
                    <th className="p-3">Entry Zone</th>
                    <th className="p-3">Stop Loss</th>
                    <th className="p-3">Targets (TP1-3)</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Realized R</th>
                    <th className="p-3">MFE / MAE</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredSignals.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="p-8 text-center text-slate-500">
                        No signals matching the selected criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredSignals.map((sig) => {
                      const outcome = sig.outcome;
                      const status = outcome?.status || 'PENDING';
                      const isBuy = sig.direction === 'BUY';
                      const rFinal = outcome?.rFinal;

                      return (
                        <tr
                          key={sig.id}
                          className="hover:bg-white/[0.02] transition-colors group cursor-pointer"
                          onClick={() => inspectSignal(sig.id)}
                        >
                          {/* Time & Symbol */}
                          <td className="p-3">
                            <div className="font-bold text-slate-200">{sig.symbol}</div>
                            <div className="text-[10px] text-slate-400">
                              {new Date(sig.createdTs * 1000).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              })}
                            </div>
                            <div className="text-[9px] text-slate-500 flex items-center gap-1 mt-0.5">
                              <span>{sig.source === 'UNKNOWN_LEGACY' ? `Legacy · ${sig.origin}` : sig.source}</span>
                              <span className="text-slate-600">·</span>
                              <span>{sig.agreement}</span>
                              <span>·</span>
                              <span>{sig.triggerTf}</span>
                              {sig.tags?.includes('intrabar-live') && <span className="ml-1 rounded border border-cyan-500/25 bg-cyan-500/10 px-1 text-cyan-300">LIVE BAR</span>}
                            </div>
                          </td>

                          {/* Direction */}
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-bold inline-flex items-center gap-1 ${
                                isBuy
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              }`}
                            >
                              {isBuy ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                              {sig.direction}
                            </span>
                          </td>

                          {/* Grade & Score */}
                          <td className="p-3">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`px-1.5 py-0.5 rounded font-black text-[10px] ${
                                  sig.grade === 'A+'
                                    ? 'bg-[#F5C451]/20 text-[#F5C451] border border-[#F5C451]/30'
                                    : sig.grade === 'A'
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : 'bg-white/10 text-slate-300'
                                }`}
                              >
                                {sig.grade}
                              </span>
                              <span className="font-bold text-slate-300">{sig.score}</span>
                            </div>
                            <div className="text-[10px] text-slate-500 mt-0.5">{sig.session}</div>
                          </td>

                          {/* Entry */}
                          <td className="p-3">
                            <div className="font-bold text-slate-200">${sig.entryPrice.toFixed(2)}</div>
                            <div className="text-[10px] text-slate-500">
                              {outcome?.fillPrice ? `Fill: $${outcome.fillPrice.toFixed(2)}` : sig.entryType}
                            </div>
                          </td>

                          {/* SL */}
                          <td className="p-3">
                            <div className="font-bold text-rose-400">${sig.sl.toFixed(2)}</div>
                            <div className="text-[10px] text-slate-500">
                              Risk: ${Math.abs(sig.entryPrice - sig.sl).toFixed(2)}
                            </div>
                          </td>

                          {/* Targets */}
                          <td className="p-3">
                            <div className="text-slate-300">TP1: ${sig.tp1.toFixed(2)}</div>
                            <div className="text-[10px] text-slate-500">
                              TP2: ${sig.tp2.toFixed(2)} · TP3: ${sig.tp3.toFixed(2)}
                            </div>
                          </td>

                          {/* Status */}
                          <td className="p-3">
                            <span
                              className={`px-2 py-1 rounded text-[10px] font-bold inline-flex items-center gap-1 ${
                                status.startsWith('TP')
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : status === 'SL_HIT'
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                  : status === 'BE_EXIT'
                                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                                  : status === 'TRIGGERED'
                                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30 animate-pulse'
                                  : 'bg-white/5 text-slate-400'
                              }`}
                            >
                              {status === 'TP1_HIT' && '🎯 TP1 HIT'}
                              {status === 'TP2_HIT' && '🎯🎯 TP2 HIT'}
                              {status === 'TP3_HIT' && '🏆 TP3 HIT'}
                              {status === 'SL_HIT' && '🛑 SL HIT'}
                              {status === 'BE_EXIT' && '⚪ BE EXIT'}
                              {status === 'TRIGGERED' && '🔵 TRIGGERED'}
                              {status === 'PENDING' && '🟡 PENDING'}
                              {status === 'INVALIDATED' && '❌ INVALID'}
                              {status === 'TIME_STOP' && '⏱ TIME STOP'}
                            </span>
                          </td>

                          {/* Realized R */}
                          <td className="p-3">
                            {rFinal !== undefined ? (
                              <span
                                className={`font-black text-sm ${
                                  rFinal > 0
                                    ? 'text-emerald-400'
                                    : rFinal < 0
                                    ? 'text-rose-400'
                                    : 'text-slate-400'
                                }`}
                              >
                                {rFinal > 0 ? `+${rFinal.toFixed(2)}` : rFinal.toFixed(2)}R
                              </span>
                            ) : (
                              <span className="text-slate-500 font-mono">Running</span>
                            )}
                          </td>

                          {/* MFE / MAE */}
                          <td className="p-3 text-[10px]">
                            <div className="text-emerald-400">
                              MFE: +{(outcome?.rMaxMfe ?? 0).toFixed(2)}R
                            </div>
                            <div className="text-rose-400">
                              MAE: {(outcome?.rMaxMae ?? 0).toFixed(2)}R
                            </div>
                          </td>

                          {/* Actions */}
                          <td
                            className="p-3 text-right space-x-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => {
                                setTakeTradeSignal(sig);
                                setTakeForm({
                                  actualEntry: sig.entryPrice.toString(),
                                  actualSl: sig.sl.toString(),
                                  actualTp: sig.tp1.toString(),
                                  lot: '0.10',
                                  notes: '',
                                });
                              }}
                              className="px-2 py-1 rounded bg-[#F5C451]/10 hover:bg-[#F5C451]/20 text-[#F5C451] border border-[#F5C451]/30 text-[10px] font-bold"
                              title="I took this trade with my broker"
                            >
                              I Took This
                            </button>

                            <button
                              onClick={() => verifyHash(sig.id)}
                              className="p-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-slate-200"
                              title="Verify SHA-256 Hash"
                            >
                              <Lock className="w-3.5 h-3.5" />
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
      )}

      {/* VIEW: MY ACTUAL TRADES */}
      {activeView === 'my_trades' && (
        <div className="bg-[#0b0f17] border border-white/[0.08] rounded-xl p-4 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-100">Personal Execution Journal (My Trades)</h2>
              <p className="text-xs text-slate-400">
                Trades manually executed through your broker, matched against system algorithmic signals.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-black/40 text-[10px] uppercase text-slate-400 border-b border-white/[0.08]">
                  <th className="p-3">Time</th>
                  <th className="p-3">Symbol & Dir</th>
                  <th className="p-3">Actual Entry</th>
                  <th className="p-3">Stop Loss</th>
                  <th className="p-3">Take Profit</th>
                  <th className="p-3">Lot</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Actual Exit</th>
                  <th className="p-3">Actual R</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {myTrades.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-500">
                      No personal trades recorded yet. Click "I Took This" on any signal to register your execution.
                    </td>
                  </tr>
                ) : (
                  myTrades.map((t) => (
                    <tr key={t.id} className="hover:bg-white/[0.02]">
                      <td className="p-3 text-slate-400">
                        {new Date(t.takenTs * 1000).toLocaleString()}
                      </td>
                      <td className="p-3 font-bold">
                        <span className={t.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}>
                          {t.direction} {t.symbol}
                        </span>
                      </td>
                      <td className="p-3 text-slate-200">${t.actualEntry.toFixed(2)}</td>
                      <td className="p-3 text-rose-400">${t.actualSl.toFixed(2)}</td>
                      <td className="p-3 text-emerald-400">${t.actualTp.toFixed(2)}</td>
                      <td className="p-3 text-slate-300">{t.lot}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            t.status === 'OPEN'
                              ? 'bg-blue-500/20 text-blue-300'
                              : 'bg-white/10 text-slate-300'
                          }`}
                        >
                          {t.status}
                        </span>
                      </td>
                      <td className="p-3 text-slate-300">
                        {t.actualExit ? `$${t.actualExit.toFixed(2)}` : 'Active'}
                      </td>
                      <td className="p-3 font-bold">
                        {t.actualR !== undefined ? (
                          <span className={t.actualR >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {t.actualR >= 0 ? `+${t.actualR}` : t.actualR}R
                          </span>
                        ) : (
                          'Running'
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW: COMPARE (Execution Gap & Slippage) */}
      {activeView === 'compare' && (
        <div className="bg-[#0b0f17] border border-white/[0.08] rounded-xl p-4 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-100">Execution Gap & Slippage Analysis</h2>
              <p className="text-xs text-slate-400">
                Compares your actual fill & exit results against the mathematical system plan. Identifies broker slippage and execution drift.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-black/40 text-[10px] uppercase text-slate-400 border-b border-white/[0.08]">
                  <th className="p-3">Signal ID</th>
                  <th className="p-3">Direction</th>
                  <th className="p-3">Taken</th>
                  <th className="p-3">System R</th>
                  <th className="p-3">My Actual R</th>
                  <th className="p-3">Execution Gap (ΔR)</th>
                  <th className="p-3">Entry Slippage</th>
                  <th className="p-3">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {compareTrades.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-500">
                      No comparative executions found. Log trades using "I Took This" to evaluate execution drift.
                    </td>
                  </tr>
                ) : (
                  compareTrades.map((c) => (
                    <tr key={c.signalId} className="hover:bg-white/[0.02]">
                      <td className="p-3 font-mono text-slate-300">{c.signalId}</td>
                      <td className="p-3 font-bold">
                        <span className={c.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}>
                          {c.direction}
                        </span>
                      </td>
                      <td className="p-3">
                        {c.taken ? (
                          <span className="text-emerald-400 font-bold">✓ Executed</span>
                        ) : (
                          <span className="text-slate-500">Skipped</span>
                        )}
                      </td>
                      <td className="p-3 font-bold">{c.signalR >= 0 ? `+${c.signalR}` : c.signalR}R</td>
                      <td className="p-3 font-bold">{c.taken ? `${c.myR >= 0 ? `+${c.myR}` : c.myR}R` : 'N/A'}</td>
                      <td className="p-3 font-bold">
                        {c.taken ? (
                          <span className={c.executionGapR >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {c.executionGapR >= 0 ? `+${c.executionGapR}` : c.executionGapR}R
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="p-3 text-slate-300">
                        {c.taken ? `${c.slippagePoints} pts` : '—'}
                      </td>
                      <td className="p-3 text-slate-400">{c.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VISUAL ANALYTICS SECTION (Equity, Distribution, Calibration, Factors) */}
      <div className="bg-[#0b0f17] border border-white/[0.08] rounded-xl p-5 shadow-2xl space-y-4">
        <div className="flex flex-wrap items-center justify-between border-b border-white/[0.08] pb-3 gap-2">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-[#F5C451]" />
            <span className="text-xs font-bold text-slate-100 uppercase tracking-wider">
              Empirical Quantitative Analytics
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-xs bg-black/40 p-1 rounded-lg border border-white/[0.06]">
            <button
              onClick={() => setAnalyticsTab('equity')}
              className={`px-3 py-1 rounded font-semibold transition-all ${
                analyticsTab === 'equity' ? 'bg-[#F5C451] text-black shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Cumulative R Curve
            </button>
            <button
              onClick={() => setAnalyticsTab('distribution')}
              className={`px-3 py-1 rounded font-semibold transition-all ${
                analyticsTab === 'distribution' ? 'bg-[#F5C451] text-black shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              R-Distribution
            </button>
            <button
              onClick={() => setAnalyticsTab('calibration')}
              className={`px-3 py-1 rounded font-semibold transition-all ${
                analyticsTab === 'calibration' ? 'bg-[#F5C451] text-black shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Score Calibration
            </button>
            <button
              onClick={() => setAnalyticsTab('factors')}
              className={`px-3 py-1 rounded font-semibold transition-all ${
                analyticsTab === 'factors' ? 'bg-[#F5C451] text-black shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Factor Attribution
            </button>
          </div>
        </div>

        {/* Tab 1: Cumulative R Equity Curve */}
        {analyticsTab === 'equity' && (
          <div className="space-y-3">
            <div className="h-64 bg-black/40 rounded-xl p-4 border border-white/[0.04] flex flex-col justify-between relative overflow-hidden">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Realized R Equity Curve (Chronological)</span>
                <span className="text-emerald-400 font-bold">
                  Peak: +{equityCurve[equityCurve.length - 1]?.r || 0}R
                </span>
              </div>

              {/* Simple SVG Curve */}
              <div className="w-full h-44 flex items-end">
                {equityCurve.length === 0 ? (
                  <div className="w-full h-full flex items-center justify-center text-xs text-slate-500">
                    No resolved trades in database yet. Run live feed or replay backfill to build curve.
                  </div>
                ) : (
                  <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 100">
                    <defs>
                      <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22E58B" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#22E58B" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>

                    {/* Polyline of R */}
                    {(() => {
                      const minR = Math.min(0, ...equityCurve.map((p) => p.r));
                      const maxR = Math.max(5, ...equityCurve.map((p) => p.r));
                      const range = maxR - minR || 1;

                      const pts = equityCurve
                        .map((p, i) => {
                          const x = (i / Math.max(1, equityCurve.length - 1)) * 100;
                          const y = 100 - ((p.r - minR) / range) * 85 - 10;
                          return `${x.toFixed(1)},${y.toFixed(1)}`;
                        })
                        .join(' ');

                      return (
                        <>
                          <polyline fill="none" stroke="#22E58B" strokeWidth="2" points={pts} />
                          {/* Zero Line */}
                          <line
                            x1="0"
                            y1={100 - ((0 - minR) / range) * 85 - 10}
                            x2="100"
                            y2={100 - ((0 - minR) / range) * 85 - 10}
                            stroke="#ffffff"
                            strokeOpacity="0.15"
                            strokeDasharray="2,2"
                          />
                        </>
                      );
                    })()}
                  </svg>
                )}
              </div>

              <div className="flex justify-between text-[10px] text-slate-500">
                <span>Genesis</span>
                <span>Latest Resolved</span>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: R-Distribution Histogram */}
        {analyticsTab === 'distribution' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
              {rDistribution.map((b) => (
                <div key={b.range} className="bg-black/30 border border-white/[0.04] p-3 rounded-lg text-center">
                  <div className="text-[10px] text-slate-400 font-bold mb-2">{b.range}</div>
                  <div className="h-28 bg-white/[0.02] rounded flex items-end justify-center p-1">
                    <div
                      className="w-full bg-[#F5C451] rounded-t transition-all"
                      style={{ height: `${Math.min(100, b.percentage * 2)}%` }}
                    />
                  </div>
                  <div className="text-xs font-bold text-slate-200 mt-2">{b.count} trades</div>
                  <div className="text-[10px] text-slate-400">{b.percentage}%</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 3: Calibration Table */}
        {analyticsTab === 'calibration' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-black/40 text-[10px] uppercase text-slate-400 border-b border-white/[0.08]">
                  <th className="p-3">Score Tier</th>
                  <th className="p-3">Trades</th>
                  <th className="p-3">Wins</th>
                  <th className="p-3">Losses</th>
                  <th className="p-3">Win Rate (Wilson 95% CI)</th>
                  <th className="p-3">Avg R</th>
                  <th className="p-3">Expectancy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {(segments?.byGrade || []).map((g: any) => (
                  <tr key={g.key} className="hover:bg-white/[0.02]">
                    <td className="p-3 font-bold text-slate-200">{g.name}</td>
                    <td className="p-3 text-slate-300">{g.total}</td>
                    <td className="p-3 text-emerald-400 font-bold">{g.wins}</td>
                    <td className="p-3 text-rose-400 font-bold">{g.losses}</td>
                    <td className="p-3">
                      {g.isSampleSufficient ? (
                        <span className="font-bold text-slate-200">
                          {g.winRate}% [{g.wilsonInterval[0]}%, {g.wilsonInterval[1]}%]
                        </span>
                      ) : (
                        <span className="text-amber-400 text-[10px] bg-amber-400/10 px-1.5 py-0.5 rounded">
                          insufficient sample (n={g.total})
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-slate-200">{g.avgR}R</td>
                    <td className="p-3 font-bold text-emerald-400">{g.expectancyR}R</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 4: Factor Attribution */}
        {analyticsTab === 'factors' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-black/40 text-[10px] uppercase text-slate-400 border-b border-white/[0.08]">
                  <th className="p-3">Market Factor</th>
                  <th className="p-3">Samples</th>
                  <th className="p-3">Win Rate</th>
                  <th className="p-3">Expectancy</th>
                  <th className="p-3">Wilson Interval</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {(segments?.bySession || []).map((s: any) => (
                  <tr key={s.key} className="hover:bg-white/[0.02]">
                    <td className="p-3 font-bold text-slate-200">{s.name} Session</td>
                    <td className="p-3 text-slate-300">{s.total}</td>
                    <td className="p-3 font-bold text-slate-200">{s.winRate}%</td>
                    <td className="p-3 font-bold text-emerald-400">+{s.expectancyR}R</td>
                    <td className="p-3 text-slate-400">[{s.wilsonInterval[0]}%, {s.wilsonInterval[1]}%]</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SIGNAL DETAIL DRAWER */}
      {selectedSignalId && signalDetail && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex justify-end">
          <div className="w-full max-w-xl bg-[#0b0f17] border-l border-white/[0.1] h-full p-6 overflow-y-auto space-y-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
              <div>
                <span className="text-[10px] font-bold text-[#F5C451] uppercase tracking-wider">
                  SIGNAL INSPECTOR & AUDIT PROOF
                </span>
                <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2 mt-0.5">
                  <span>{signalDetail.signal.symbol}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-bold ${
                      signalDetail.signal.direction === 'BUY'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-rose-500/20 text-rose-400'
                    }`}
                  >
                    {signalDetail.signal.direction}
                  </span>
                  <span className="text-xs text-slate-400">({signalDetail.signal.triggerTf})</span>
                </h2>
              </div>
              <button
                onClick={() => {
                  setSelectedSignalId(null);
                  setSignalDetail(null);
                }}
                className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Cryptographic SHA-256 Hash Verification */}
            <div className="bg-black/40 border border-white/[0.06] rounded-xl p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between text-slate-300">
                <span className="flex items-center gap-1.5 font-bold">
                  <Lock className="w-3.5 h-3.5 text-[#F5C451]" />
                  SHA-256 Snapshot Hash
                </span>
                <button
                  onClick={() => verifyHash(signalDetail.signal.id)}
                  className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold text-[10px]"
                >
                  Verify Integrity
                </button>
              </div>
              <div className="font-mono text-[10px] text-slate-400 break-all bg-black/60 p-2 rounded border border-white/[0.04]">
                {signalDetail.signal.snapshotHash}
              </div>
              <div className="text-[10px] text-slate-500">
                Parent Hash: {signalDetail.signal.prevHash.substring(0, 16)}...
              </div>
            </div>

            {/* Execution Levels */}
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="bg-white/[0.02] p-2 rounded border border-white/[0.04]">
                <span className="text-[10px] text-slate-400 block">Entry Zone</span>
                <span className="font-bold text-slate-100">${signalDetail.signal.entryPrice.toFixed(2)}</span>
              </div>
              <div className="bg-rose-500/5 p-2 rounded border border-rose-500/15">
                <span className="text-[10px] text-rose-400 block">Stop Loss</span>
                <span className="font-bold text-rose-400">${signalDetail.signal.sl.toFixed(2)}</span>
              </div>
              <div className="bg-emerald-500/5 p-2 rounded border border-emerald-500/15">
                <span className="text-[10px] text-emerald-400 block">TP1 Target</span>
                <span className="font-bold text-emerald-400">${signalDetail.signal.tp1.toFixed(2)}</span>
              </div>
            </div>

            {/* Chronological Timeline Events */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                Append-Only Lifecycle Events
              </h3>
              <div className="space-y-2">
                {signalDetail.events.length === 0 ? (
                  <div className="text-xs text-slate-500">No events logged yet.</div>
                ) : (
                  signalDetail.events.map((ev, i) => (
                    <div
                      key={ev.id || i}
                      className="p-2.5 rounded-lg bg-black/40 border border-white/[0.04] text-xs flex items-start justify-between"
                    >
                      <div>
                        <div className="font-bold text-slate-200 flex items-center gap-1.5">
                          <span>{ev.type}</span>
                          <span className="text-[10px] text-slate-500 font-normal">({ev.source})</span>
                        </div>
                        {ev.note && <div className="text-[11px] text-slate-400 mt-0.5">{ev.note}</div>}
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-slate-300">${ev.price.toFixed(2)}</div>
                        <div className="text-[10px] text-slate-500">
                          {new Date(ev.tsUtc * 1000).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Journal Notes Editor */}
            <div className="space-y-2 border-t border-white/[0.08] pt-4">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Personal Journal & Post-Trade Review
              </h3>
              <textarea
                value={notesInput}
                onChange={(e) => setNotesInput(e.target.value)}
                placeholder="Log your execution observations, emotional discipline, or slippage notes..."
                className="w-full h-24 bg-black/40 border border-white/[0.08] rounded-lg p-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#F5C451]"
              />
              <button
                onClick={saveNotes}
                disabled={isSavingNotes}
                className="px-4 py-2 rounded-lg bg-[#F5C451] hover:bg-[#e0b03e] text-black font-bold text-xs transition-all"
              >
                {isSavingNotes ? 'Saving...' : 'Save Journal Note'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* "I TOOK THIS" MODAL */}
      {takeTradeSignal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0b0f17] border border-white/[0.1] rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div>
                <span className="text-[10px] font-bold text-[#F5C451] uppercase">Broker Execution Link</span>
                <h2 className="text-base font-bold text-slate-100">
                  Log "{takeTradeSignal.direction} {takeTradeSignal.symbol}"
                </h2>
              </div>
              <button
                onClick={() => setTakeTradeSignal(null)}
                className="p-1 rounded-lg bg-white/[0.04] text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Actual Entry Price ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={takeForm.actualEntry}
                  onChange={(e) => setTakeForm({ ...takeForm, actualEntry: e.target.value })}
                  className="w-full bg-black/40 border border-white/[0.08] rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-[#F5C451]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Stop Loss ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={takeForm.actualSl}
                    onChange={(e) => setTakeForm({ ...takeForm, actualSl: e.target.value })}
                    className="w-full bg-black/40 border border-white/[0.08] rounded-lg p-2.5 text-slate-200 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Take Profit ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={takeForm.actualTp}
                    onChange={(e) => setTakeForm({ ...takeForm, actualTp: e.target.value })}
                    className="w-full bg-black/40 border border-white/[0.08] rounded-lg p-2.5 text-slate-200 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Lot Size</label>
                <input
                  type="number"
                  step="0.01"
                  value={takeForm.lot}
                  onChange={(e) => setTakeForm({ ...takeForm, lot: e.target.value })}
                  className="w-full bg-black/40 border border-white/[0.08] rounded-lg p-2.5 text-slate-200 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Execution Note</label>
                <input
                  type="text"
                  placeholder="e.g. Executed on OANDA MT5, 0.2 pt slippage"
                  value={takeForm.notes}
                  onChange={(e) => setTakeForm({ ...takeForm, notes: e.target.value })}
                  className="w-full bg-black/40 border border-white/[0.08] rounded-lg p-2.5 text-slate-200 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setTakeTradeSignal(null)}
                className="px-4 py-2 rounded-lg bg-white/[0.04] text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={submitMyTrade}
                className="px-4 py-2 rounded-lg bg-[#F5C451] hover:bg-[#e0b03e] text-black text-xs font-bold transition-all"
              >
                Record in Journal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HASH VERIFICATION MODAL */}
      {verifyResult && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0b0f17] border border-white/[0.1] rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div className="flex items-center gap-2">
                {verifyResult.isValid ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : (
                  <XCircle className="w-5 h-5 text-rose-400" />
                )}
                <h2 className="text-base font-bold text-slate-100">
                  Cryptographic Integrity Verification
                </h2>
              </div>
              <button
                onClick={() => setVerifyResult(null)}
                className="p-1 rounded-lg bg-white/[0.04] text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="p-3 rounded-lg bg-black/40 border border-white/[0.04] space-y-2">
                <div className="text-slate-400">Recomputed SHA-256 Hash:</div>
                <div className="font-mono text-[10px] text-emerald-300 break-all">
                  {verifyResult.expectedHash}
                </div>
                <div className="text-slate-400 mt-2">Stored Immutable Hash:</div>
                <div className="font-mono text-[10px] text-cyan-300 break-all">
                  {verifyResult.storedHash}
                </div>
              </div>

              <div className="text-xs text-slate-300">
                {verifyResult.isValid ? (
                  <span className="text-emerald-400 font-bold">
                    ✓ 100% Cryptographic Match. Parameters (direction, entry price, SL, TP) remain untouched since creation.
                  </span>
                ) : (
                  <span className="text-rose-400 font-bold">
                    ✗ Mismatch detected. Immutability violation!
                  </span>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setVerifyResult(null)}
                className="px-4 py-2 rounded-lg bg-white/[0.08] text-slate-200 text-xs font-semibold"
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
