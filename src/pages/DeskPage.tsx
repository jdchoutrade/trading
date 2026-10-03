import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useTerminal } from '../context/TerminalContext.tsx';
import {
  createChart,
  ColorType,
  IChartApi,
  CandlestickSeries,
  CandlestickData,
  Time,
} from 'lightweight-charts';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart2,
  CheckCircle,
  Clock,
  Compass,
  DollarSign,
  Globe,
  Layers,
  Percent,
  Radio,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';
import {
  CorrelationMatrixItem,
  CrossAssetQuote,
  MacroDataPoint,
  MarketNewsStory,
  RiskOffClassification,
  ScenarioItem,
  ScheduledEconomicEvent,
  ShockAlert,
  Timeframe,
} from '../types.ts';
import { cleanChartCandles } from '../utils/chartData.ts';

export const DeskPage: React.FC = () => {
  const { snapshot, candles, candlesSymbol, candlesTimeframe, currentPrice, activeSymbol, activeTimeframe, runAnalysisWithAnimation, setIsAskQraOpen } = useTerminal();
  const chartCandles = useMemo(() => cleanChartCandles(candles, activeSymbol, activeTimeframe), [candles, activeSymbol, activeTimeframe]);

  const [deskData, setDeskData] = useState<{
    crossAssets: CrossAssetQuote[];
    correlations: CorrelationMatrixItem[];
    macro: MacroDataPoint[];
    riskOff: RiskOffClassification;
    scenarios: ScenarioItem[];
    griIndex?: number;
    recentStories: MarketNewsStory[];
    activeShock: ShockAlert | null;
    scheduledEvents: ScheduledEconomicEvent[];
    calendarStatus: { source: string; fetchedAt: number; isAvailable: boolean };
  } | null>(null);

  const [archiveStories, setArchiveStories] = useState<MarketNewsStory[]>([]);
  const [newsPage, setNewsPage] = useState(0);
  const [storyTotal, setStoryTotal] = useState(0);
  const storiesPerPage = 12;

  // Chart ref
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<any>(null);
  const chartTimeframeRef = useRef<Timeframe | null>(null);
  const chartSymbolRef = useRef<string | null>(null);
  const lastChartCandleTimeRef = useRef<number | null>(null);
  const chartWindowRef = useRef<{ count: number; firstTime: number | null } | null>(null);

  // Fetch Desk bundle
  const loadDeskData = async () => {
    try {
      const [deskRes, intelRes] = await Promise.all([
        fetch('/api/desk'),
        fetch(`/api/intel?limit=${storiesPerPage}&offset=${newsPage * storiesPerPage}`),
      ]);
      const [deskJson, intelJson] = await Promise.all([deskRes.json(), intelRes.json()]);
      if (deskJson.success) setDeskData(deskJson);
      if (intelJson.success) {
        setArchiveStories(intelJson.stories || []);
        setStoryTotal(intelJson.totalStories || 0);
      }
    } catch (e) {
      console.warn('Failed to load desk data:', e);
    }
  };

  useEffect(() => {
    loadDeskData();
    const interval = setInterval(loadDeskData, 20000);
    return () => clearInterval(interval);
  }, [newsPage]);

  // Mini Chart init
  useEffect(() => {
    if (!chartContainerRef.current) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#090d14' },
        textColor: '#64748b',
        fontSize: 10,
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.02)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.02)' },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.06)',
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.06)',
      },
    });

    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22E58B',
      downColor: '#FF4D6D',
      borderVisible: false,
      wickUpColor: '#22E58B',
      wickDownColor: '#FF4D6D',
    });
    candleSeriesRef.current = candleSeries;

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : undefined;
    if (resizeObserver && chartContainerRef.current) resizeObserver.observe(chartContainerRef.current);
    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      candleSeriesRef.current = null;
      chartTimeframeRef.current = null;
      chartSymbolRef.current = null;
      lastChartCandleTimeRef.current = null;
      chartWindowRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || !chartCandles.length || candlesSymbol !== activeSymbol || candlesTimeframe !== activeTimeframe) return;
    const displayCandles = chartCandles.slice(-100);
    const last = displayCandles[displayCandles.length - 1];
    const formatted: CandlestickData<Time>[] = displayCandles.map((candle) => ({
      time: candle.time as Time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
    const reset = chartSymbolRef.current !== activeSymbol || chartTimeframeRef.current !== activeTimeframe || lastChartCandleTimeRef.current === null || last.time < lastChartCandleTimeRef.current;
    const firstTime = displayCandles[0]?.time ?? null;
    const windowChanged = chartWindowRef.current?.count !== displayCandles.length || chartWindowRef.current?.firstTime !== firstTime;
    if (reset) {
      series.setData(formatted);
      chartRef.current?.timeScale().fitContent();
      chartTimeframeRef.current = activeTimeframe;
      chartSymbolRef.current = activeSymbol;
    } else if (windowChanged) {
      series.setData(formatted);
    } else {
      series.update({ time: last.time as Time, open: last.open, high: last.high, low: last.low, close: last.close });
    }
    lastChartCandleTimeRef.current = last.time;
    chartWindowRef.current = { count: displayCandles.length, firstTime };
  }, [chartCandles, candlesSymbol, candlesTimeframe, activeSymbol, activeTimeframe]);

  // Real-time tick update
  useEffect(() => {
    const last = chartCandles[chartCandles.length - 1];
    if (!candleSeriesRef.current || !last || candlesSymbol !== activeSymbol || candlesTimeframe !== activeTimeframe || lastChartCandleTimeRef.current !== last.time) return;
    candleSeriesRef.current.update({
      time: last.time as Time,
      open: last.open,
      high: Math.max(last.high, currentPrice),
      low: Math.min(last.low, currentPrice),
      close: currentPrice,
    });
  }, [currentPrice, chartCandles, candlesSymbol, candlesTimeframe, activeSymbol, activeTimeframe]);

  const gri = deskData?.griIndex ?? snapshot?.griIndex;
  const shock = deskData?.activeShock || snapshot?.activeShock;
  const upcomingEvents = (deskData?.scheduledEvents || snapshot?.scheduledEvents || [])
    .filter((event) => event.impact === 'HIGH')
    .slice(0, 6);
  const localEventTime = (event: ScheduledEconomicEvent) => new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Phnom_Penh', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(event.scheduledAt * 1000));

  return (
    <div className="flex-1 bg-[#07090d] overflow-y-auto p-4 space-y-4 font-mono select-none">
      {/* Top Cross-Asset Ticker Ribbon */}
      <div className="bg-[#0b0f17] border border-white/[0.06] rounded-xl p-3 shadow-lg">
        <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2 border-b border-white/[0.04] pb-1.5">
          <div className="flex items-center gap-2">
            <Globe className="w-3.5 h-3.5 text-[#3DDCFF]" />
            <span className="font-bold text-slate-200">CROSS-ASSET MACRO STRIP</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Yahoo 5m quotes
            </span>
          </div>
          <span className="text-[10px] text-slate-500">Yahoo cross-assets · refreshed about every 60s · TV gold ticks</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-10 gap-2">
          {(deskData?.crossAssets || []).map((asset) => (
            <div
              key={asset.symbol}
              className="bg-black/30 border border-white/[0.04] rounded-lg p-2 flex flex-col justify-between"
            >
              <div className="flex justify-between items-center text-[10px] text-slate-400">
                <span className="font-bold text-slate-200">{asset.symbol}</span>
                <span className={asset.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(2)}%
                </span>
              </div>
              <div className="text-xs font-bold text-slate-100 mt-1">
                {asset.price < 10 ? asset.price.toFixed(3) : asset.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className={`text-[8px] mt-1 ${Date.now() - asset.lastUpdated > 15 * 60_000 ? 'text-rose-400' : 'text-slate-600'}`}>
                Quote as of {new Date(asset.lastUpdated).toLocaleTimeString()}
              </div>
            </div>
          ))}
          {!deskData?.crossAssets?.length && <div className="col-span-full text-xs text-slate-500">No verified cross-asset quotes received yet.</div>}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section className="bg-[#0b0f17] border border-white/[0.06] rounded-xl p-4 shadow-lg space-y-3">
          <div className="flex items-center justify-between border-b border-white/[0.04] pb-2">
            <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-[#F5C451]" />UPCOMING HIGH-IMPACT RELEASES</span>
            <span className="text-[10px] text-slate-500">Cambodia time · Forex Factory + BLS calendar</span>
          </div>
          {upcomingEvents.length ? upcomingEvents.map((event) => {
            const seconds = event.scheduledAt - Math.floor(Date.now() / 1000);
            const countdown = seconds <= 0 ? 'RELEASED' : seconds < 3600 ? `IN ${Math.ceil(seconds / 60)} MIN` : `IN ${Math.floor(seconds / 3600)}H ${Math.floor((seconds % 3600) / 60)}M`;
            return (
              <a key={event.id} href={event.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 bg-black/30 p-2.5 rounded-lg border border-white/[0.04] hover:border-[#F5C451]/30">
                <div className="min-w-0">
                  <div className="text-xs text-slate-100 font-semibold truncate">{event.title}</div>
                  <div className="text-[10px] text-slate-500">{event.country} · {localEventTime(event)} · {event.source}</div>
                  {(event.actual || event.forecast || event.previous) && (
                    <div className="text-[9px] text-slate-400 mt-1">
                      Actual {event.actual || '—'} · Forecast {event.forecast || '—'} · Previous {event.previous || '—'}
                    </div>
                  )}
                </div>
                <span className={`shrink-0 text-[10px] font-bold ${seconds <= 0 ? 'text-rose-300' : 'text-[#F5C451]'}`}>{countdown}</span>
              </a>
            );
          }) : <div className="text-xs text-slate-500 py-3">{deskData?.calendarStatus?.isAvailable ? 'No high-impact events are listed in the loaded calendar window.' : 'Waiting for Forex Factory or BLS calendar data.'}</div>}
          <div className="text-[9px] text-slate-600">{deskData?.calendarStatus?.fetchedAt ? `Sources: ${deskData.calendarStatus.source} · fetched ${new Date(deskData.calendarStatus.fetchedAt).toLocaleString()}. Schedule time is not a release result.` : 'Times are shown only after a calendar feed loads.'}</div>
        </section>

        <section className="bg-[#0b0f17] border border-white/[0.06] rounded-xl p-4 shadow-lg space-y-3">
          <div className="flex items-center justify-between border-b border-white/[0.04] pb-2">
            <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5 text-cyan-300" />MARKET NEWS ARCHIVE</span>
            <span className="text-[10px] text-slate-500">{storyTotal.toLocaleString()} archived headlines · newest first</span>
          </div>
          {archiveStories.map((story) => {
            const observedStory = newsPage === 0 ? snapshot?.recentStories?.find((candidate) => candidate.id === story.id) : undefined;
            const impact = observedStory?.goldImpact || story.goldImpact;
            return (
              <article key={story.id} className="bg-black/30 p-2.5 rounded-lg border border-white/[0.04]">
                <div className="flex items-start justify-between gap-2">
                  <a href={story.url || undefined} target="_blank" rel="noreferrer" className="text-xs text-slate-100 font-semibold hover:text-[#F5C451] line-clamp-2">{story.title}</a>
                  <span className={`shrink-0 text-[9px] ${story.verificationStatus === 'MULTI-SOURCE' || story.verificationStatus === 'PRICE-CONFIRMED' ? 'text-emerald-300' : 'text-amber-300'}`}>{story.verificationStatus}</span>
                </div>
                {story.summary && <p className="text-[10px] text-slate-400 mt-1 line-clamp-2">{story.summary}</p>}
                <div className="text-[9px] text-slate-600 mt-1">{story.source} · {new Date(story.publishedAt * 1000).toLocaleString()} · observed gold reaction {impact.toLowerCase()}{observedStory?.reasoningKm ? ` · ${observedStory.reasoningKm}` : ' · no causal direction inferred'}</div>
              </article>
            );
          })}
          {!archiveStories.length && <div className="text-xs text-slate-500 py-3">No headlines have been received from configured feeds yet.</div>}
          <div className="flex items-center justify-between text-[10px] pt-1">
            <button disabled={newsPage === 0} onClick={() => setNewsPage((page) => Math.max(0, page - 1))} className="px-2 py-1 rounded border border-white/[0.08] text-slate-300 disabled:opacity-30">Newer</button>
            <span className="text-slate-500">Page {newsPage + 1} of {Math.max(1, Math.ceil(storyTotal / storiesPerPage))} · Archive limit 5,000</span>
            <button disabled={(newsPage + 1) * storiesPerPage >= storyTotal} onClick={() => setNewsPage((page) => page + 1)} className="px-2 py-1 rounded border border-white/[0.08] text-slate-300 disabled:opacity-30">Older</button>
          </div>
        </section>
      </div>

      {/* Main Grid: Live Chart + Signal Fusion Waterfall */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left 2 Cols: XAUUSD Live Snapshot & Macro Overview */}
        <div className="lg:col-span-2 space-y-4">
          {/* Live Mini Chart Container */}
          <div className="bg-[#0b0f17] border border-white/[0.06] rounded-xl p-4 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-base font-bold text-slate-100">XAUUSD Gold Spot</span>
                  <span className="text-2xl font-bold text-[#F5C451]">${currentPrice.toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px]">
                  <Radio className="w-3 h-3 animate-pulse" />
                  <span>Real-time Tick Stream</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={runAnalysisWithAnimation}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#F5C451] hover:bg-[#e0b03e] text-black font-bold text-xs shadow"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Run Pipeline</span>
                </button>
                <button
                  onClick={() => setIsAskQraOpen(true)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-white/[0.05] hover:bg-white/[0.08] text-slate-200 text-xs border border-white/[0.08]"
                >
                  <span>Ask QRA</span>
                </button>
              </div>
            </div>

            <div className="h-64 w-full rounded-lg overflow-hidden border border-white/[0.04]">
              <div ref={chartContainerRef} className="w-full h-full" />
            </div>

            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
              <div className="bg-black/30 p-2 rounded border border-white/[0.04]">
                <span className="text-[10px] text-slate-500 block">Spread</span>
                <span className="font-bold text-slate-200">{snapshot ? `$${snapshot.spread.toFixed(2)}` : 'N/A'}</span>
              </div>
              <div className="bg-black/30 p-2 rounded border border-white/[0.04]">
                <span className="text-[10px] text-slate-500 block">ATR (14)</span>
                <span className="font-bold text-slate-200">{snapshot?.atr14 ? `${snapshot.atr14.toFixed(2)} pts` : 'N/A'}</span>
              </div>
              <div className="bg-black/30 p-2 rounded border border-white/[0.04]">
                <span className="text-[10px] text-slate-500 block">Active Regime</span>
                <span className="font-bold text-cyan-400">{snapshot?.regime.type.replace('TREND_', '') || 'N/A'}</span>
              </div>
              <div className="bg-black/30 p-2 rounded border border-white/[0.04]">
                <span className="text-[10px] text-slate-500 block">H1 Bias</span>
                <span className="font-bold text-emerald-400">{snapshot?.mtfBias.h1Bias || 'N/A'}</span>
              </div>
            </div>
          </div>

          {/* Macro Baseline & Scenarios */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Macro Data Points with strict "as of" dates */}
            <div className="bg-[#0b0f17] border border-white/[0.06] rounded-xl p-4 shadow-lg space-y-2.5">
              <div className="flex items-center justify-between border-b border-white/[0.04] pb-2">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <BarChart2 className="w-3.5 h-3.5 text-[#F5C451]" />
                  MACROECONOMIC FUNDAMENTALS
                </span>
                <span className="text-[10px] text-slate-500">Explicit "As Of" Dates</span>
              </div>

              <div className="space-y-1.5 text-xs">
                {(deskData?.macro || []).map((m) => (
                  <div key={m.id} className="flex justify-between items-center bg-black/20 p-2 rounded border border-white/[0.03]">
                    <div>
                      <div className="text-slate-300 font-semibold">{m.name}</div>
                      <div className="text-[9px] text-slate-500">As of {m.asOf} · {m.source}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-slate-100">{m.formattedValue}</div>
                      <span className={`text-[9px] font-bold ${
                        m.biasForGold === 'BULLISH' ? 'text-emerald-400' : m.biasForGold === 'BEARISH' ? 'text-rose-400' : 'text-slate-400'
                      }`}>
                        {m.biasForGold}
                      </span>
                    </div>
                  </div>
                ))}
                {!deskData?.macro?.length && <div className="text-[11px] text-slate-500 p-2">No live macro series configured. Macro bias is excluded from signal scoring until an as-of-dated source is available.</div>}
              </div>
            </div>

            {/* Rolling Correlation Matrix */}
            <div className="bg-[#0b0f17] border border-white/[0.06] rounded-xl p-4 shadow-lg space-y-2.5">
              <div className="flex items-center justify-between border-b border-white/[0.04] pb-2">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 text-purple-400" />
                  ROLLING CORRELATIONS (30D)
                </span>
                <span className="text-[10px] text-slate-500">XAUUSD Benchmark</span>
              </div>

              <div className="space-y-1.5 text-xs">
                {(deskData?.correlations || []).map((c, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-black/20 p-2 rounded border border-white/[0.03]">
                    <div>
                      <div className="text-slate-300 font-semibold">{c.assetA} vs {c.assetB}</div>
                      <div className="text-[9px] text-slate-500">{c.divergenceReason || 'Normal rolling correlation'}</div>
                    </div>
                    <div className="text-right">
                      <div className={`font-bold ${c.correlation > 0 ? 'text-emerald-400' : 'text-cyan-400'}`}>
                        {c.correlation > 0 ? '+' : ''}{c.correlation.toFixed(2)}
                      </div>
                      <span className={`text-[9px] px-1 py-0.2 rounded ${c.isBroken ? 'bg-rose-500/20 text-rose-300' : 'bg-white/[0.04] text-slate-400'}`}>
                        {c.isBroken ? 'DECOUPLED' : 'NORMAL'}
                      </span>
                    </div>
                  </div>
                ))}
                {!deskData?.correlations?.length && <div className="text-[11px] text-slate-500 p-2">No aligned rolling return series is available to calculate correlations.</div>}
              </div>
            </div>
          </div>
        </div>

        {/* Right Col: Signal Fusion Waterfall & Market Intel */}
        <div className="space-y-4">
          {/* Signal Fusion Waterfall */}
          <div className="bg-[#0b0f17] border border-white/[0.06] rounded-xl p-4 shadow-lg space-y-3">
            <div className="flex items-center justify-between border-b border-white/[0.04] pb-2">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-[#F5C451]" />
                SIGNAL FUSION WATERFALL
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F5C451]/10 text-[#F5C451] font-bold">
                  {snapshot?.grade || 'N/A'} Grade
              </span>
            </div>

            {/* Final Verdict Banner */}
            <div className="p-3 rounded-lg bg-black/40 border border-white/[0.05] flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-500 block">ALGORITHMIC VERDICT</span>
                <span className={`text-lg font-bold ${
                  snapshot?.verdict === 'BUY' ? 'text-emerald-400' : snapshot?.verdict === 'SELL' ? 'text-rose-400' : 'text-[#F5C451]'
                }`}>
                  {snapshot?.verdict || 'WAIT'}
                </span>
              </div>
              <div className="text-right">
                  <span className="text-[10px] text-slate-500 block">ENGINE SCORE · NOT WIN PROBABILITY</span>
                <span className="text-lg font-bold text-slate-100">
                  {Math.max(snapshot?.buyScore || 0, snapshot?.sellScore || 0)} / 100
                </span>
              </div>
            </div>

            {/* Waterfall Layers */}
            <div className="space-y-2 text-xs">
              {(snapshot?.analysisStages || []).map((step) => (
                <div key={step.index} className="bg-white/[0.02] p-2 rounded border border-white/[0.04] space-y-1">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-300 font-semibold">L{step.index}: {step.name}</span>
                    <span className={`font-bold ${step.status === 'PASS' ? 'text-emerald-400' : step.status === 'WAIT' ? 'text-amber-300' : 'text-rose-300'}`}>{step.status}</span>
                  </div>
                  <div className="text-[10px] text-slate-500">{step.evidence}</div>
                </div>
              ))}
              {!snapshot?.analysisStages?.length && <div className="text-xs text-slate-500">Waiting for the live analysis pipeline.</div>}
            </div>
          </div>

          {/* Market Intelligence & Geopolitical Risk (GRI) */}
          <div className="bg-[#0b0f17] border border-white/[0.06] rounded-xl p-4 shadow-lg space-y-3">
            <div className="flex items-center justify-between border-b border-white/[0.04] pb-2">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                MARKET INTELLIGENCE & GRI
              </span>
              <span className="text-[10px] text-slate-400">No calibrated GRI feed</span>
            </div>

            {/* GRI Gauge */}
            <div className="bg-black/30 p-3 rounded-lg border border-white/[0.04] space-y-2">
              {gri === undefined
                ? <div className="text-xs text-slate-400">GRI is unavailable. News headlines are classified by topic; they do not imply a gold direction without observed price reaction.</div>
                : <div className="text-xs text-slate-400">GRI: <span className="font-bold text-[#F5C451]">{gri}/100</span></div>}
            </div>

            {/* Unscheduled Shock Alert */}
            {shock && shock.status === 'ACTIVE' ? (
              <div className="p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-bold">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400 animate-bounce" />
                  <span>UNSCHEDULED MARKET SHOCK DETECTED</span>
                </div>
                <div className="text-[10px] text-rose-200">
                  Velocity: {shock.velocityAtr.toFixed(1)}x ATR | Spread Multiplier: {shock.spreadMultiplier.toFixed(1)}x
                </div>
              </div>
            ) : (
              <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
                <CheckCircle className="w-3.5 h-3.5" />
                <span>No active price shock detected in the latest observed candles.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
