import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTerminal } from '../context/TerminalContext.tsx';
import {
  createChart,
  ColorType,
  IChartApi,
  CandlestickSeries,
  CandlestickData,
  LineSeries,
  Time,
} from 'lightweight-charts';
import {
  Activity,
  Bot,
  CheckCircle,
  Clock,
  Layers,
  Maximize2,
  Minus,
  MoveRight,
  Palette,
  Play,
  Radio,
  Send,
  Sparkles,
  Square,
  Target,
  Trash2,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { Timeframe } from '../types.ts';
import { cleanChartCandles } from '../utils/chartData.ts';

export const TradingViewLivePage: React.FC = () => {
  const {
    activeSymbol,
    activeTimeframe,
    setActiveTimeframe,
    snapshot,
    candles,
    candlesSymbol,
    candlesTimeframe,
    currentPrice,
    runAnalysisWithAnimation,
    isDrawerOpen,
    setIsDrawerOpen,
    isAnalyzeRunning,
    analyzeStep,
    setIsAskQraOpen,
    setActiveTab,
    t,
  } = useTerminal();
  const chartCandles = useMemo(() => cleanChartCandles(candles, activeSymbol, activeTimeframe), [candles, activeSymbol, activeTimeframe]);

  // Overlay toggles
  const [showEma, setShowEma] = useState<boolean>(true);
  const [showSessions, setShowSessions] = useState<boolean>(true);
  const [showLevels, setShowLevels] = useState<boolean>(true);
  const [activeDrawingTool, setActiveDrawingTool] = useState<'NONE' | 'HLINE' | 'RECT' | 'TREND'>('NONE');
  const [userDrawings, setUserDrawings] = useState<Array<{ id: string; type: string; price: number; label: string }>>([]);

  const [telegramStatus, setTelegramStatus] = useState<string | null>(null);

  // Chart DOM container and series references
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<any>(null);
  const ema50SeriesRef = useRef<any>(null);
  const ema200SeriesRef = useRef<any>(null);
  const chartTimeframeRef = useRef<Timeframe | null>(null);
  const chartSymbolRef = useRef<string | null>(null);
  const lastChartCandleTimeRef = useRef<number | null>(null);
  const chartWindowRef = useRef<{ count: number; firstTime: number | null } | null>(null);

  // Timeframes available
  const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', 'D'];

  // Initialize unified Lightweight Chart
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
        vertLine: { color: 'rgba(245, 196, 81, 0.5)', width: 1, style: 2 },
        horzLine: { color: 'rgba(245, 196, 81, 0.5)', width: 1, style: 2 },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
      },
    });

    chartRef.current = chart;

    // Candlestick Series (Gold / SMC Theme)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22E58B',
      downColor: '#FF4D6D',
      borderVisible: false,
      wickUpColor: '#22E58B',
      wickDownColor: '#FF4D6D',
    });
    candleSeriesRef.current = candleSeries;

    // EMA 50 (Cyan)
    const ema50 = chart.addSeries(LineSeries, {
      color: '#3DDCFF',
      lineWidth: 1,
      title: 'EMA 50',
    });
    ema50SeriesRef.current = ema50;

    // EMA 200 (Gold)
    const ema200 = chart.addSeries(LineSeries, {
      color: '#F5C451',
      lineWidth: 1,
      title: 'EMA 200',
    });
    ema200SeriesRef.current = ema200;

    // Resize observer
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
      ema50SeriesRef.current = null;
      ema200SeriesRef.current = null;
      chartTimeframeRef.current = null;
      chartSymbolRef.current = null;
      lastChartCandleTimeRef.current = null;
      chartWindowRef.current = null;
    };
  }, [activeSymbol, activeTimeframe]);

  // Load history on timeframe changes; update only the latest bar for live snapshots.
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries || !chartCandles.length || candlesSymbol !== activeSymbol || candlesTimeframe !== activeTimeframe) return;
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
      candleSeries.setData(formatted);
      chartRef.current?.timeScale().fitContent();
      chartTimeframeRef.current = activeTimeframe;
      chartSymbolRef.current = activeSymbol;
    } else if (windowChanged) {
      candleSeries.setData(formatted);
    } else {
      candleSeries.update({ time: last.time as Time, open: last.open, high: last.high, low: last.low, close: last.close });
    }
    lastChartCandleTimeRef.current = last.time;
    chartWindowRef.current = { count: chartCandles.length, firstTime };

    const ema50 = ema50SeriesRef.current;
    const ema200 = ema200SeriesRef.current;
    if (ema50) {
      if (showEma && chartCandles.length >= 50) {
        const k = 2 / 51;
        let value = chartCandles[0].close;
        ema50.setData(chartCandles.map((candle, index) => {
          value = index === 0 ? candle.close : candle.close * k + value * (1 - k);
          return { time: candle.time as Time, value: Number(value.toFixed(2)) };
        }));
      } else ema50.setData([]);
    }
    if (ema200) {
      if (showEma && chartCandles.length >= 200) {
        const k200 = 2 / 201;
        let value = chartCandles[0].close;
        ema200.setData(chartCandles.map((candle, index) => {
          value = index === 0 ? candle.close : candle.close * k200 + value * (1 - k200);
          return { time: candle.time as Time, value: Number(value.toFixed(2)) };
        }));
      } else ema200.setData([]);
    }
  }, [chartCandles, candlesSymbol, candlesTimeframe, activeSymbol, activeTimeframe, showEma]);

  // Keep the forming candle current without replacing history or resetting pan/zoom.
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const last = chartCandles[chartCandles.length - 1];
    if (!candleSeries || !last || candlesSymbol !== activeSymbol || candlesTimeframe !== activeTimeframe || lastChartCandleTimeRef.current !== last.time) return;
    candleSeries.update({
      time: last.time as Time,
      open: last.open,
      high: Math.max(last.high, currentPrice),
      low: Math.min(last.low, currentPrice),
      close: currentPrice,
    });
  }, [currentPrice, chartCandles, candlesSymbol, candlesTimeframe, activeSymbol, activeTimeframe]);

  // Handle Telegram broadcast
  const handleSendTelegram = async () => {
    setTelegramStatus('Sending...');
    try {
      const res = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: activeSymbol, timeframe: activeTimeframe }),
      });
      const data = await res.json();
      if (data.success) {
        setTelegramStatus('Alert sent to Telegram!');
      } else {
        setTelegramStatus(data.error || 'Failed to send');
      }
    } catch (e: any) {
      setTelegramStatus(e.message || 'Network error');
    }
    setTimeout(() => setTelegramStatus(null), 3000);
  };

  // Add a horizontal ray at current price
  const handleAddPriceRay = () => {
    const newDrawing = {
      id: `draw_${Date.now()}`,
      type: 'HLINE',
      price: currentPrice,
      label: `Price Level $${currentPrice.toFixed(2)}`,
    };
    setUserDrawings((prev) => [newDrawing, ...prev]);
    setActiveDrawingTool('NONE');
  };

  const handleClearDrawings = () => {
    setUserDrawings([]);
  };

  // 12-Step pipeline labels
  const PIPELINE_STEPS = [
    { num: 1, name: 'L1: Market Regime', desc: 'ADX, ATR percentile, BB width' },
    { num: 2, name: 'L2: Multi-Timeframe', desc: 'H1 Bias → M15 Structure → M5 Entry' },
    { num: 3, name: 'L3: Liquidity Map', desc: 'Swing H/L, Sessions, EQH/EQL, Pools' },
    { num: 4, name: 'L4: SMC Engine', desc: 'BOS, CHoCH, OB, FVG, Sweeps' },
    { num: 5, name: 'L5: Momentum', desc: 'RSI Divergence, MACD Slope, ADX' },
    { num: 6, name: 'L6: Volatility', desc: 'ATR(14), Bollinger Squeeze' },
    { num: 7, name: 'L7: Volume & VWAP', desc: 'Volume Spike, Session VWAP ±1σ' },
    { num: 8, name: 'L8: Candle Patterns', desc: 'Engulfing, Rejection Wick, Break-Retest' },
    { num: 9, name: 'L9: Session Filter', desc: 'London / NY Killzones, Rollover' },
    { num: 10, name: 'L10: Confirmation', desc: 'Weighted non-rigid matrix scoring' },
    { num: 11, name: 'L11: Signal Scoring', desc: 'Score 0-100, Grades A+ to X, Lock' },
    { num: 12, name: 'L12: DeepSeek Review', desc: 'Second opinion, Agreement %, Khmer/EN' },
  ];

  return (
    <div className="flex-1 flex flex-col relative bg-[#07090d] overflow-hidden select-none font-mono">
      {/* Top Institutional Chart Toolbar */}
      <div className="h-12 bg-[#090d14] border-b border-white/[0.08] px-4 flex items-center justify-between z-10 shrink-0">
        {/* Left: Timeframe Switchers & Drawing Tools */}
        <div className="flex items-center gap-2">
          {/* Timeframe Selector */}
          <div className="flex bg-black/40 p-0.5 rounded-lg border border-white/[0.06]">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => setActiveTimeframe(tf)}
                className={`px-2.5 py-1 text-[11px] font-bold rounded transition-all ${
                  activeTimeframe === tf
                    ? 'bg-[#F5C451] text-black shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-white/[0.08] mx-1" />

          {/* Quick Overlays */}
          <button
            onClick={() => setShowEma(!showEma)}
            className={`px-2 py-1 rounded text-[11px] border transition-all ${
              showEma
                ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30 font-bold'
                : 'bg-white/[0.02] text-slate-500 border-white/[0.04]'
            }`}
          >
            EMA 50/200
          </button>

          <button
            onClick={() => setShowSessions(!showSessions)}
            className={`px-2 py-1 rounded text-[11px] border transition-all ${
              showSessions
                ? 'bg-[#F5C451]/10 text-[#F5C451] border-[#F5C451]/30 font-bold'
                : 'bg-white/[0.02] text-slate-500 border-white/[0.04]'
            }`}
          >
            Sessions
          </button>

          <button
            onClick={() => setShowLevels(!showLevels)}
            className={`px-2 py-1 rounded text-[11px] border transition-all ${
              showLevels
                ? 'bg-purple-500/10 text-purple-400 border-purple-500/30 font-bold'
                : 'bg-white/[0.02] text-slate-500 border-white/[0.04]'
            }`}
          >
            Liquidity Pools
          </button>

          <div className="h-4 w-px bg-white/[0.08] mx-1" />

          {/* Drawing Tools */}
          <button
            onClick={handleAddPriceRay}
            title="Mark Horizontal Price Level"
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] text-slate-300"
          >
            <Minus className="w-3.5 h-3.5 text-[#F5C451]" />
            <span>+ H-Line</span>
          </button>

          {userDrawings.length > 0 && (
            <button
              onClick={handleClearDrawings}
              title="Clear drawings"
              className="p-1 rounded text-rose-400 hover:bg-rose-500/10 border border-rose-500/20"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {/* Feed sync indicator */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px]">
            <Radio className="w-3 h-3 animate-pulse" />
            <span>LIVE SYNC · 0.2s</span>
          </div>

          <button
            onClick={runAnalysisWithAnimation}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#F5C451] hover:bg-[#e0b03e] text-black text-xs font-bold shadow-md shadow-[#F5C451]/20 transition-all"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Analyze Pipeline</span>
          </button>

          <button
            onClick={() => setIsDrawerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-slate-200 text-xs transition-all"
          >
            <Layers className="w-3.5 h-3.5 text-[#3DDCFF]" />
            <span>Setup Plan</span>
          </button>

          <button
            onClick={() => setIsAskQraOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-slate-200 text-xs transition-all"
          >
            <Bot className="w-3.5 h-3.5 text-[#22E58B]" />
            <span>Ask AI</span>
          </button>

          <button
            onClick={handleSendTelegram}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs transition-all"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Telegram</span>
          </button>

          {telegramStatus && (
            <span className="text-xs text-[#F5C451] animate-pulse">
              {telegramStatus}
            </span>
          )}
        </div>
      </div>

      {/* Main Chart Area */}
      <div className="flex-1 w-full h-full relative">
        <div ref={chartContainerRef} className="w-full h-full" />

        {/* Floating Live Quote HUD */}
        <div className="absolute top-4 left-4 bg-[#090d14]/90 backdrop-blur-md border border-white/[0.08] rounded-xl p-3 shadow-xl pointer-events-none z-10 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-100">{activeSymbol}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
              {activeTimeframe}
            </span>
            <span className="text-[10px] text-slate-400">Lightweight Charts Live</span>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[#F5C451]">
              ${currentPrice.toFixed(2)}
            </span>
            <span className="text-[10px] text-slate-400">
              Spread: ${(snapshot?.spread || 0.35).toFixed(2)}
            </span>
          </div>

          {snapshot?.regime && (
            <div className="text-[10px] text-slate-400 flex items-center gap-1.5 pt-0.5">
              <span>Regime:</span>
              <span className="text-slate-200 font-bold">{snapshot.regime.type}</span>
              <span>· Bias:</span>
              <span className="text-cyan-400 font-bold">{snapshot.mtfBias.h1Bias}</span>
            </div>
          )}
        </div>

        {/* User Drawn Price Levels Overlay */}
        {userDrawings.length > 0 && (
          <div className="absolute top-4 right-4 bg-[#090d14]/90 backdrop-blur-md border border-white/[0.08] rounded-xl p-2.5 shadow-xl z-10 space-y-1 max-w-xs">
            <div className="text-[10px] font-bold text-slate-300 uppercase tracking-wider mb-1 flex justify-between">
              <span>Active Drawings</span>
              <span className="text-[#F5C451]">{userDrawings.length}</span>
            </div>
            {userDrawings.map((d) => (
              <div key={d.id} className="text-[11px] flex justify-between items-center bg-white/[0.02] px-2 py-1 rounded">
                <span className="text-slate-300">{d.label}</span>
                <span className="text-slate-400 font-semibold">${d.price.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 12-Step Animated Analysis Pipeline Side Drawer */}
      {isDrawerOpen && (
        <div className="fixed inset-y-0 right-0 w-[420px] bg-[#090d14]/95 backdrop-blur-xl border-l border-white/[0.08] shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
          {/* Drawer Header */}
          <div className="p-4 border-b border-white/[0.08] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#F5C451]" />
              <span className="font-bold text-sm text-slate-100">
                12-STEP QUANT PIPELINE
              </span>
            </div>
            <button
              onClick={() => setIsDrawerOpen(false)}
              className="p-1 rounded hover:bg-white/[0.08] text-slate-400 hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Drawer Body: 12 Steps list & Results */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
            {/* Progress Bar */}
            <div className="space-y-1.5 bg-white/[0.02] p-3 rounded-lg border border-white/[0.05]">
              <div className="flex justify-between text-slate-400 text-[11px]">
                <span>Pipeline Execution</span>
                <span className="text-[#F5C451] font-bold">
                  {isAnalyzeRunning ? `Step ${analyzeStep} / 12` : 'Completed'}
                </span>
              </div>
              <div className="w-full bg-white/[0.05] h-1.5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 via-[#F5C451] to-cyan-500 transition-all duration-300"
                  style={{ width: `${(Math.max(analyzeStep, isAnalyzeRunning ? 1 : 12) / 12) * 100}%` }}
                />
              </div>
            </div>

            {/* Steps list */}
            <div className="space-y-1.5">
              {PIPELINE_STEPS.map((step) => {
                const isPassed = !isAnalyzeRunning || analyzeStep >= step.num;
                const isCurrent = isAnalyzeRunning && analyzeStep === step.num;

                return (
                  <div
                    key={step.num}
                    className={`p-2.5 rounded-lg border transition-all ${
                      isCurrent
                        ? 'bg-[#F5C451]/10 border-[#F5C451]/40 text-slate-100'
                        : isPassed
                        ? 'bg-white/[0.02] border-white/[0.05] text-slate-300'
                        : 'bg-transparent border-transparent text-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
                            isCurrent
                              ? 'bg-[#F5C451] text-black animate-pulse'
                              : isPassed
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-white/[0.05] text-slate-600'
                          }`}
                        >
                          {step.num}
                        </span>
                        <span className="font-semibold text-[11px]">{step.name}</span>
                      </div>
                      {isPassed && !isAnalyzeRunning && (
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 pl-7 mt-0.5">{step.desc}</div>
                  </div>
                );
              })}
            </div>

            {/* Verdict summary */}
            {snapshot && (
              <div className="p-3.5 rounded-xl bg-black/40 border border-white/[0.08] space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400">Final Verdict:</span>
                  <span className="font-bold text-[#F5C451] text-sm">{snapshot.verdict} (Grade {snapshot.grade})</span>
                </div>
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>Buy Score: {snapshot.buyScore}/100</span>
                  <span>Sell Score: {snapshot.sellScore}/100</span>
                </div>
                {snapshot.tradePlan && (
                  <div className="pt-2 border-t border-white/[0.06] text-[10px] text-slate-300 space-y-1">
                    <div className="flex justify-between">
                      <span>Entry:</span>
                      <span className="font-bold">${snapshot.tradePlan.entryPrice}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Stop Loss:</span>
                      <span className="text-rose-400 font-bold">${snapshot.tradePlan.stopLoss}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>TP1 / TP2:</span>
                      <span className="text-emerald-400 font-bold">${snapshot.tradePlan.tp1} / ${snapshot.tradePlan.tp2}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
