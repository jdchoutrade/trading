import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Layers,
  Lock,
  Send,
  Shield,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react';
import type { Timeframe } from '../types.ts';
import { cleanChartCandles } from '../utils/chartData.ts';

export const IndicatorsPage: React.FC = () => {
  const { snapshot, aiReviewSnapshot, candles, candlesSymbol, candlesTimeframe, currentPrice, activeSymbol, activeTimeframe, runAnalysisWithAnimation, t } = useTerminal();
  const chartCandles = useMemo(() => cleanChartCandles(candles, activeSymbol, activeTimeframe), [candles, activeSymbol, activeTimeframe]);

  // Overlay toggles
  const [showRails, setShowRails] = useState<boolean>(true);
  const [showPools, setShowPools] = useState<boolean>(true);
  const [showZones, setShowZones] = useState<boolean>(true);
  const [showMarks, setShowMarks] = useState<boolean>(true);
  const [showEntry, setShowEntry] = useState<boolean>(true);
  const [showPlan, setShowPlan] = useState<boolean>(true);

  // Expandable sections on right panel
  const [expandedSection, setExpandedSection] = useState<'whyBuy' | 'whySell' | 'qraExplains' | null>('qraExplains');

  // Chart DOM container refs
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<any>(null);
  const priceLinesRef = useRef<any[]>([]);
  const lastChartCandleTimeRef = useRef<number | null>(null);
  const chartTimeframeRef = useRef<Timeframe | null>(null);
  const chartSymbolRef = useRef<string | null>(null);
  const chartWindowRef = useRef<{ count: number; firstTime: number | null } | null>(null);

  // Initialize and update Lightweight Charts
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    // Clean up previous chart instance
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#07090d' },
        textColor: '#94a3b8',
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      crosshair: {
        vertLine: { color: 'rgba(245, 196, 81, 0.4)', width: 1, style: 2 },
        horzLine: { color: 'rgba(245, 196, 81, 0.4)', width: 1, style: 2 },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.06)',
        timeVisible: true,
        secondsVisible: false,
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
    const trackedPriceLine = (options: any) => {
      if (!Number.isFinite(options.price) || options.price <= 0) return;
      priceLinesRef.current.push(candleSeries.createPriceLine(options));
    };

    // Format and set candle data
    if (candlesSymbol === activeSymbol && candlesTimeframe === activeTimeframe && chartCandles.length > 0) {
      const formatted: CandlestickData<Time>[] = chartCandles.map((c) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
      candleSeries.setData(formatted);

      // Add Price Lines for Rails & SMC levels
      if (showRails && snapshot?.session) {
        if (snapshot.session.pdh) {
          trackedPriceLine({
            price: snapshot.session.pdh,
            color: '#FF5BD1',
            lineWidth: 1,
            lineStyle: 1,
            axisLabelVisible: true,
            title: 'PDH',
          });
        }
        if (snapshot.session.pdl) {
          trackedPriceLine({
            price: snapshot.session.pdl,
            color: '#FF5BD1',
            lineWidth: 1,
            lineStyle: 1,
            axisLabelVisible: true,
            title: 'PDL',
          });
        }
        if (snapshot.session.dailyOpen) {
          trackedPriceLine({
            price: snapshot.session.dailyOpen,
            color: '#3DDCFF',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'D-OPEN',
          });
        }
        if (snapshot.session.asiaRange) {
          trackedPriceLine({
            price: snapshot.session.asiaRange.high,
            color: '#F5C451',
            lineWidth: 1,
            lineStyle: 3,
            axisLabelVisible: true,
            title: 'ASIA-H',
          });
          trackedPriceLine({
            price: snapshot.session.asiaRange.low,
            color: '#F5C451',
            lineWidth: 1,
            lineStyle: 3,
            axisLabelVisible: true,
            title: 'ASIA-L',
          });
        }
      }

      // Add Entry, SL, TP lines if showEntry is true
      if (showEntry && snapshot?.tradePlan) {
        const plan = snapshot.tradePlan;
        trackedPriceLine({
          price: plan.entryPrice,
          color: '#F5C451',
          lineWidth: 2,
          lineStyle: 0,
          axisLabelVisible: true,
          title: `ENTRY (${plan.entryPrice})`,
        });
        trackedPriceLine({
          price: plan.stopLoss,
          color: '#FF4D6D',
          lineWidth: 2,
          lineStyle: 0,
          axisLabelVisible: true,
          title: `SL (${plan.stopLoss})`,
        });
        trackedPriceLine({
          price: plan.tp1,
          color: '#22E58B',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: `TP1 (${plan.tp1})`,
        });
        trackedPriceLine({
          price: plan.tp2,
          color: '#22E58B',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: `TP2 (${plan.tp2})`,
        });
      }
    }

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
    if (resizeObserver) resizeObserver.observe(container);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      candleSeriesRef.current = null;
      priceLinesRef.current = [];
      lastChartCandleTimeRef.current = null;
      chartTimeframeRef.current = null;
      chartSymbolRef.current = null;
      chartWindowRef.current = null;
    };
  }, []);

  // Update the existing chart series in place so live snapshots preserve pan/zoom.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || !chartCandles.length || candlesSymbol !== activeSymbol || candlesTimeframe !== activeTimeframe) return;
    const last = chartCandles[chartCandles.length - 1];
    const formatted: CandlestickData<Time>[] = chartCandles.map((candle) => ({
      time: candle.time as Time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
    const reset = chartSymbolRef.current !== activeSymbol
      || chartTimeframeRef.current !== activeTimeframe
      || lastChartCandleTimeRef.current === null
      || last.time < lastChartCandleTimeRef.current;
    const firstTime = chartCandles[0]?.time ?? null;
    const windowChanged = chartWindowRef.current?.count !== chartCandles.length
      || chartWindowRef.current?.firstTime !== firstTime;
    if (reset) {
      series.setData(formatted);
      chartRef.current?.timeScale().fitContent();
      chartTimeframeRef.current = activeTimeframe;
      chartSymbolRef.current = activeSymbol;
    } else if (windowChanged) {
      // Replace corrected/rolled history without changing the user's visible range.
      series.setData(formatted);
    } else {
      series.update({ time: last.time as Time, open: last.open, high: last.high, low: last.low, close: last.close });
    }
    lastChartCandleTimeRef.current = last.time;
    chartWindowRef.current = { count: chartCandles.length, firstTime };
  }, [chartCandles, candlesSymbol, candlesTimeframe, activeSymbol, activeTimeframe]);

  useEffect(() => {
    const series = candleSeriesRef.current;
    const last = chartCandles[chartCandles.length - 1];
    if (!series || !last || candlesSymbol !== activeSymbol || candlesTimeframe !== activeTimeframe || lastChartCandleTimeRef.current !== last.time) return;
    series.update({
      time: last.time as Time,
      open: last.open,
      high: Math.max(last.high, currentPrice),
      low: Math.min(last.low, currentPrice),
      close: currentPrice,
    });
  }, [currentPrice, chartCandles, candlesSymbol, candlesTimeframe, activeSymbol, activeTimeframe]);

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    for (const line of priceLinesRef.current) series.removePriceLine(line);
    priceLinesRef.current = [];
    const addPriceLine = (options: any) => {
      if (!Number.isFinite(options.price) || options.price <= 0) return;
      priceLinesRef.current.push(series.createPriceLine(options));
    };
    if (showRails && snapshot?.session) {
      if (snapshot.session.pdh !== undefined) addPriceLine({ price: snapshot.session.pdh, color: '#FF5BD1', lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: 'PDH' });
      if (snapshot.session.pdl !== undefined) addPriceLine({ price: snapshot.session.pdl, color: '#FF5BD1', lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: 'PDL' });
      if (snapshot.session.dailyOpen !== undefined) addPriceLine({ price: snapshot.session.dailyOpen, color: '#3DDCFF', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'D-OPEN' });
      if (snapshot.session.asiaRange) {
        addPriceLine({ price: snapshot.session.asiaRange.high, color: '#F5C451', lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: 'ASIA-H' });
        addPriceLine({ price: snapshot.session.asiaRange.low, color: '#F5C451', lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: 'ASIA-L' });
      }
    }
    if (showEntry && snapshot?.tradePlan) {
      const plan = snapshot.tradePlan;
      addPriceLine({ price: plan.entryPrice, color: '#F5C451', lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: `ENTRY (${plan.entryPrice})` });
      addPriceLine({ price: plan.stopLoss, color: '#FF4D6D', lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: `SL (${plan.stopLoss})` });
      addPriceLine({ price: plan.tp1, color: '#22E58B', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `TP1 (${plan.tp1})` });
      addPriceLine({ price: plan.tp2, color: '#22E58B', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `TP2 (${plan.tp2})` });
    }
  }, [showRails, showEntry, snapshot]);

  // Factor status styling helper
  const getFactorColor = (status: string) => {
    switch (status) {
      case 'pass':
        return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
      case 'partial':
        return 'bg-[#F5C451]/15 text-[#F5C451] border-[#F5C451]/30';
      case 'fail':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      default:
        return 'bg-white/[0.02] text-slate-500 border-white/[0.05]';
    }
  };

  const plan = snapshot?.tradePlan;
  const isBuy = snapshot?.verdict === 'BUY' || snapshot?.verdict === 'BUY_LEANS';
  const progressScore = Math.max(snapshot?.buyScore || 0, snapshot?.sellScore || 0);
  const aiReview = aiReviewSnapshot?.review;
  const aiReviewFresh = Boolean(
    aiReview
    && Date.now() / 1000 - aiReview.reviewedAt <= 60
    && Math.abs(currentPrice - (aiReviewSnapshot?.reviewedPrice || 0)) <= 0.5
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
      {/* Center Left: Chart & Sub-Histograms */}
      <div className="w-full h-[52vh] min-h-[320px] flex-none flex flex-col min-w-0 bg-[#07090d] lg:h-auto lg:flex-1 lg:min-h-0">
        {/* Toggle Chips Toolbar & Legend Strip */}
        <div className="h-10 bg-[#0a0d14] border-b border-white/[0.06] px-4 flex items-center justify-between gap-2 shrink-0 select-none overflow-x-auto whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase text-slate-500 mr-1 flex items-center gap-1">
              <Layers className="w-3 h-3 text-[#F5C451]" /> Overlays:
            </span>

            <button
              onClick={() => setShowRails(!showRails)}
              className={`px-2 py-0.8 rounded text-[11px] font-mono transition-all border ${
                showRails
                  ? 'bg-purple-500/15 text-purple-300 border-purple-500/40'
                  : 'bg-white/[0.02] text-slate-500 border-white/[0.05]'
              }`}
            >
              Rails (Asia/Lon/PDH)
            </button>

            <button
              onClick={() => setShowPools(!showPools)}
              className={`px-2 py-0.8 rounded text-[11px] font-mono transition-all border ${
                showPools
                  ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                  : 'bg-white/[0.02] text-slate-500 border-white/[0.05]'
              }`}
            >
              Pools (Liquidity)
            </button>

            <button
              onClick={() => setShowZones(!showZones)}
              className={`px-2 py-0.8 rounded text-[11px] font-mono transition-all border ${
                showZones
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                  : 'bg-white/[0.02] text-slate-500 border-white/[0.05]'
              }`}
            >
              Zones (OB & FVG)
            </button>

            <button
              onClick={() => setShowMarks(!showMarks)}
              className={`px-2 py-0.8 rounded text-[11px] font-mono transition-all border ${
                showMarks
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                  : 'bg-white/[0.02] text-slate-500 border-white/[0.05]'
              }`}
            >
              Marks (BOS/CHoCH)
            </button>

            <button
              onClick={() => setShowEntry(!showEntry)}
              className={`px-2 py-0.8 rounded text-[11px] font-mono transition-all border ${
                showEntry
                  ? 'bg-[#F5C451]/20 text-[#F5C451] border-[#F5C451]/40'
                  : 'bg-white/[0.02] text-slate-500 border-white/[0.05]'
              }`}
            >
              Entry & SL/TP
            </button>

            <button
              onClick={() => setShowPlan(!showPlan)}
              className={`px-2 py-0.8 rounded text-[11px] font-mono transition-all border ${
                showPlan
                  ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40'
                  : 'bg-white/[0.02] text-slate-500 border-white/[0.05]'
              }`}
            >
              Plan Overlay
            </button>
          </div>

          {/* Quick Legend Tags */}
          <div className="hidden md:flex items-center gap-3 text-[10px] font-mono text-slate-400">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#FF5BD1]"></span> PDH/PDL
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#3DDCFF]"></span> Daily Open
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#F5C451]"></span> Asia Range
            </span>
          </div>
        </div>

        {/* Lightweight Charts Canvas */}
        <div className="flex-1 relative min-h-[260px] lg:min-h-[350px]">
          <div ref={chartContainerRef} className="absolute inset-0 w-full h-full" />

          {/* Floating Live Badge inside Chart */}
          <div className="absolute top-3 left-3 bg-[#0d1118]/85 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 text-xs font-mono shadow-xl pointer-events-none">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-100">{snapshot?.symbol || 'XAUUSD'}</span>
              <span className="text-[#F5C451]">{currentPrice.toFixed(2)}</span>
              <span className="text-slate-400 text-[10px]">
                {snapshot?.mtfBias.premiumDiscountZone}
              </span>
            </div>
          </div>
        </div>

        {/* Sub-Panels: Histograms (Quality & Bias vs Open) */}
        <div className="hidden lg:flex h-32 bg-[#090c12] border-t border-white/[0.06] divide-x divide-white/[0.06] shrink-0 select-none">
          {/* Sub-panel 1: QUALITY · S H F K O T histogram */}
          <div className="flex-1 p-2.5 flex flex-col justify-between">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <div className="flex items-center gap-1.5 text-slate-400 font-semibold">
                <span className="text-[#F5C451]">QUALITY HISTOGRAM</span>
                <span>·</span>
                <span className="text-slate-500">S H F K O T</span>
              </div>
              <span className="text-[10px] text-slate-500">Scale (-5 ... +5)</span>
            </div>

            {/* Simulated histogram bars for each factor */}
            <div className="grid grid-cols-6 gap-2 items-end h-16 pt-2">
              {[
                { code: 'S', val: snapshot?.buyFactors.find((f) => f.code === 'S')?.status === 'pass' ? 4.5 : -1.5 },
                { code: 'H', val: snapshot?.mtfBias.h1Bias === 'BULL' ? 4.0 : snapshot?.mtfBias.h1Bias === 'BEAR' ? -4.0 : 0.5 },
                { code: 'F', val: snapshot?.fvgs.some((f) => !f.filled) ? 3.5 : -2.0 },
                { code: 'K', val: snapshot?.recentSweeps.length ? 5.0 : -1.0 },
                { code: 'O', val: snapshot?.orderBlocks.some((ob) => !ob.mitigated) ? 4.0 : -1.5 },
                { code: 'T', val: snapshot?.session.isKillZone ? 5.0 : 2.0 },
              ].map((item) => (
                <div key={item.code} className="flex flex-col items-center gap-1">
                  <div className="w-full flex items-center justify-center">
                    <div
                      className={`w-6 rounded-sm transition-all ${
                        item.val >= 0
                          ? 'bg-emerald-500/80 shadow-sm shadow-emerald-500/30'
                          : 'bg-rose-500/80 shadow-sm shadow-rose-500/30'
                      }`}
                      style={{ height: `${Math.abs(item.val) * 8 + 4}px` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">{item.code}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Sub-panel 2: BIAS vs OPEN · ATR × 100 */}
          <div className="w-80 p-2.5 flex flex-col justify-between">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-[#3DDCFF] font-semibold">BIAS vs OPEN</span>
              <span className="text-[10px] text-slate-500">ATR × 100</span>
            </div>

            <div className="space-y-1.5 my-auto">
              <div className="flex justify-between text-[11px] font-mono">
                <span className="text-slate-400">Deviation from Open:</span>
                <span
                  className={
                    snapshot?.session.dailyOpen && currentPrice >= snapshot.session.dailyOpen
                      ? 'text-emerald-400 font-semibold'
                      : 'text-rose-400 font-semibold'
                  }
                >
                  {snapshot?.session.dailyOpen
                    ? `${(currentPrice - snapshot.session.dailyOpen).toFixed(2)} pts`
                    : '+0.00 pts'}
                </span>
              </div>

              <div className="w-full bg-white/[0.04] h-2 rounded-full overflow-hidden flex">
                <div
                  className="bg-rose-500/60 h-full"
                  style={{ width: `${Math.min(50, Math.max(10, 50 - (snapshot?.atr14 || 1) * 10))}%` }}
                />
                <div className="w-0.5 h-full bg-white" />
                <div
                  className="bg-emerald-500/80 h-full"
                  style={{ width: `${Math.min(50, Math.max(10, (snapshot?.atr14 || 1) * 10))}%` }}
                />
              </div>

              <div className="flex justify-between text-[10px] font-mono text-slate-500">
                <span>Discount Zone</span>
                <span>Equilibrium</span>
                <span>Premium Zone</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Column: INDICATORS & QRA Read Panel */}
      <div className="w-full bg-[#090c12] border-t border-white/[0.06] flex flex-col overflow-y-visible shrink-0 select-none lg:w-96 lg:border-t-0 lg:border-l lg:overflow-y-auto">
        <div className="p-3 border-b border-white/[0.06] bg-[#0d1118]/60 flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-slate-200">
            <Target className="w-3.5 h-3.5 text-[#F5C451]" />
            <span>INDICATORS ENGINE</span>
          </div>

          <button
            onClick={runAnalysisWithAnimation}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[#F5C451]/15 hover:bg-[#F5C451]/25 text-[#F5C451] text-[11px] font-mono transition-all"
          >
            <Sparkles className="w-3 h-3" />
            <span>Re-scan</span>
          </button>
        </div>

        <div className="p-3.5 space-y-3.5 lg:flex-1">
          {/* 1. "QRA READ" Card */}
          <div className="bg-[#0e131d] rounded-xl border border-white/[0.07] p-3.5 shadow-lg space-y-2.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400 font-medium">QRA READ</span>
              <span
                className={`font-bold px-2 py-0.5 rounded text-[11px] ${
                  snapshot?.verdict === 'BUY'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : snapshot?.verdict === 'SELL'
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    : 'bg-white/[0.05] text-slate-300'
                }`}
              >
                {snapshot?.verdict || 'WAIT'}
              </span>
            </div>

            {/* Progress bar (e.g. 6-5 leads) */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-mono">
                <span className="text-slate-400">Confirmation Score</span>
                <span className="text-[#F5C451] font-bold">{progressScore}/100</span>
              </div>
              <div className="w-full bg-white/[0.05] h-2 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    isBuy ? 'bg-gradient-to-r from-emerald-500 to-[#F5C451]' : 'bg-gradient-to-r from-rose-500 to-[#F5C451]'
                  }`}
                  style={{ width: `${progressScore}%` }}
                />
              </div>
            </div>

            <p className="text-xs text-slate-300 font-mono leading-relaxed">
              {snapshot?.regime.description || 'Analyzing market equilibrium...'}
            </p>
          </div>

          {/* 2. BEST PLACE TO ENTER Card */}
          {plan ? (
            <div className="bg-[#0e131d] rounded-xl border border-white/[0.07] p-3.5 shadow-lg space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 beacon-pulse" />
                  <span className="text-xs font-mono font-bold text-slate-200">BEST PLACE TO ENTER</span>
                </div>
                <span className="text-[10px] font-mono text-slate-400">
                  Stop: {plan.slAtrMultiple}× ATR
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="bg-white/[0.02] p-2 rounded border border-white/[0.04]">
                  <span className="text-[10px] text-slate-500 block">Entry ({plan.entryType})</span>
                  <span className="text-sm font-bold text-slate-100">{plan.entryPrice.toFixed(2)}</span>
                </div>

                <div className="bg-rose-500/5 p-2 rounded border border-rose-500/15">
                  <span className="text-[10px] text-rose-400 block">Stop Loss (SL)</span>
                  <span className="text-sm font-bold text-rose-300">{plan.stopLoss.toFixed(2)}</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1.5 text-xs font-mono">
                <div className="bg-emerald-500/5 p-1.5 rounded border border-emerald-500/15 text-center">
                  <span className="text-[9px] text-slate-500 block">TP 1</span>
                  <span className="text-xs font-bold text-emerald-400">{plan.tp1.toFixed(2)}</span>
                  <span className="text-[9px] text-slate-400 block">({plan.rr1}R)</span>
                </div>

                <div className="bg-emerald-500/5 p-1.5 rounded border border-emerald-500/15 text-center">
                  <span className="text-[9px] text-slate-500 block">TP 2</span>
                  <span className="text-xs font-bold text-emerald-400">{plan.tp2.toFixed(2)}</span>
                  <span className="text-[9px] text-slate-400 block">({plan.rr2}R)</span>
                </div>

                <div className="bg-emerald-500/5 p-1.5 rounded border border-emerald-500/15 text-center">
                  <span className="text-[9px] text-slate-500 block">TP 3</span>
                  <span className="text-xs font-bold text-emerald-400">{plan.tp3.toFixed(2)}</span>
                  <span className="text-[9px] text-slate-400 block">({plan.rr3}R)</span>
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-1 border-t border-white/[0.04]">
                <span>Rec. Lot (1% risk):</span>
                <span className="text-slate-100 font-bold">{plan.suggestedLotSize} lots</span>
              </div>
            </div>
          ) : (
            <div className="bg-[#0e131d] rounded-xl border border-white/[0.07] p-3 text-center text-xs font-mono text-slate-500">
              No immediate high-probability execution plan. Market is ranging.
            </div>
          )}

          {/* 3. Factor Chips (BUY Row & SELL Row) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400">
              <span>FACTOR MATRIX</span>
              <span className="text-[10px] text-slate-500">S H F K O T REG 4H D1 VWAP MOM RAIL</span>
            </div>

            {/* BUY Factors Row */}
            <div className="space-y-1">
              <span className="text-[10px] font-mono text-emerald-400">BUY FACTORS:</span>
              <div className="flex flex-wrap gap-1">
                {snapshot?.buyFactors.map((f) => (
                  <div
                    key={f.code}
                    title={`${f.name}: ${f.reason}`}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border cursor-help transition-transform hover:scale-105 ${getFactorColor(
                      f.status
                    )}`}
                  >
                    {f.code}
                  </div>
                ))}
              </div>
            </div>

            {/* SELL Factors Row */}
            <div className="space-y-1 pt-1">
              <span className="text-[10px] font-mono text-rose-400">SELL FACTORS:</span>
              <div className="flex flex-wrap gap-1">
                {snapshot?.sellFactors.map((f) => (
                  <div
                    key={f.code}
                    title={`${f.name}: ${f.reason}`}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border cursor-help transition-transform hover:scale-105 ${getFactorColor(
                      f.status
                    )}`}
                  >
                    {f.code}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 4. Expandable Explanations */}
          <div className="space-y-1.5 pt-1">
            {/* WHY BUY */}
            <div className="border border-white/[0.06] rounded-lg overflow-hidden bg-white/[0.01]">
              <button
                onClick={() => setExpandedSection(expandedSection === 'whyBuy' ? null : 'whyBuy')}
                className="w-full px-3 py-2 flex items-center justify-between text-xs font-mono text-emerald-300 hover:bg-white/[0.02]"
              >
                <span>WHY BUY ({snapshot?.buyScore}/100)</span>
                {expandedSection === 'whyBuy' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {expandedSection === 'whyBuy' && (
                <div className="p-2.5 bg-black/20 border-t border-white/[0.04] text-[11px] font-mono text-slate-300 space-y-1">
                  {snapshot?.buyFactors
                    .filter((f) => f.status === 'pass' || f.status === 'partial')
                    .map((f) => (
                      <div key={f.code} className="flex items-start gap-1.5">
                        <span className="text-emerald-400">✓</span>
                        <span>
                          <b>{f.name}:</b> {f.reason}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* WHY SELL */}
            <div className="border border-white/[0.06] rounded-lg overflow-hidden bg-white/[0.01]">
              <button
                onClick={() => setExpandedSection(expandedSection === 'whySell' ? null : 'whySell')}
                className="w-full px-3 py-2 flex items-center justify-between text-xs font-mono text-rose-300 hover:bg-white/[0.02]"
              >
                <span>WHY SELL ({snapshot?.sellScore}/100)</span>
                {expandedSection === 'whySell' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {expandedSection === 'whySell' && (
                <div className="p-2.5 bg-black/20 border-t border-white/[0.04] text-[11px] font-mono text-slate-300 space-y-1">
                  {snapshot?.sellFactors
                    .filter((f) => f.status === 'pass' || f.status === 'partial')
                    .map((f) => (
                      <div key={f.code} className="flex items-start gap-1.5">
                        <span className="text-rose-400">✓</span>
                        <span>
                          <b>{f.name}:</b> {f.reason}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* QRA EXPLAINS & AI AGREEMENT */}
            <div className="border border-white/[0.06] rounded-lg overflow-hidden bg-white/[0.01]">
              <button
                onClick={() => setExpandedSection(expandedSection === 'qraExplains' ? null : 'qraExplains')}
                className="w-full px-3 py-2 flex items-center justify-between text-xs font-mono text-[#F5C451] hover:bg-white/[0.02]"
              >
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    QRA EXPLAINS {aiReview ? aiReviewFresh ? `(AI AGREEMENT ${aiReview.agreement}%)` : `(AI REVIEW STALE · ${aiReview.agreement}%)` : '(AI REVIEW NOT RUN)'}
                  </span>
                </div>
                {expandedSection === 'qraExplains' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {expandedSection === 'qraExplains' && (
                <div className="p-3 bg-black/30 border-t border-white/[0.04] text-xs font-mono text-slate-300 space-y-2">
                  {aiReview ? (
                    <>
                      <div className={`text-[11px] font-semibold ${aiReviewFresh ? 'text-emerald-400' : 'text-amber-300'}`}>
                        {aiReviewFresh ? 'AI second opinion for current price' : 'Last AI second opinion · refresh before using'} · {aiReview.modelUsed} · {new Date(aiReview.reviewedAt * 1000).toLocaleTimeString()}
                      </div>
                      <div className="text-[11px] text-slate-300">AI verdict: <b>{aiReview.verdict}</b> · agreement score {aiReview.agreement}/100</div>
                      <p className="leading-relaxed text-slate-200">{aiReview.comment_km || aiReview.comment_en}</p>
                      {aiReview.comment_en && <p className="text-[11px] text-slate-400 italic">{aiReview.comment_en}</p>}
                    </>
                  ) : (
                    <p className="leading-relaxed text-slate-400">
                      No AI review has returned for this live candidate yet. The live signal engine evaluates the forming candle immediately with its technical rules; an optional AI second opinion runs separately and never delays the signal. Use Re-scan to request an on-demand review.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
