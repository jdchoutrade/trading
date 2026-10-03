import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Candle, DeepSeekReview, FullAnalysisResult, SignalEntity, SignalSource, Timeframe } from '../types.ts';

interface TerminalContextType {
  activeSymbol: string;
  setActiveSymbol: (s: string) => void;
  activeTimeframe: Timeframe;
  setActiveTimeframe: (tf: Timeframe) => void;
  currentPrice: number;
  bid: number;
  ask: number;
  spread: number;
  latencyMs: number;
  isStale: boolean;
  priceFlash: 'up' | 'down' | 'none';
  snapshot: FullAnalysisResult | null;
  aiReviewSnapshot: { review: DeepSeekReview; reviewedPrice: number } | null;
  indicatorSnapshot: FullAnalysisResult | null;
  analysisSnapshot: FullAnalysisResult | null;
  latestSourceSignals: Partial<Record<SignalSource, SignalEntity>>;
  candles: Candle[];
  candlesSymbol: string | null;
  candlesTimeframe: Timeframe | null;
  language: 'en' | 'km';
  setLanguage: (l: 'en' | 'km') => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isDrawerOpen: boolean;
  setIsDrawerOpen: (open: boolean) => void;
  isAskQraOpen: boolean;
  setIsAskQraOpen: (open: boolean) => void;
  isShortcutsOpen: boolean;
  setIsShortcutsOpen: (open: boolean) => void;
  isAnalyzeRunning: boolean;
  analyzeStep: number;
  runAnalysisWithAnimation: () => Promise<void>;
  refreshSnapshot: () => Promise<void>;
  wsConnected: boolean;
  t: (key: string, en: string, km: string) => string;
}

const TerminalContext = createContext<TerminalContextType | null>(null);

export const TerminalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeSymbol, setActiveSymbol] = useState<string>('XAUUSD');
  const [activeTimeframe, setActiveTimeframe] = useState<Timeframe>('15m');
  const [currentPrice, setCurrentPrice] = useState<number>(2658.50);
  const [bid, setBid] = useState<number>(2658.32);
  const [ask, setAsk] = useState<number>(2658.68);
  const [spread, setSpread] = useState<number>(0.35);
  const [latencyMs, setLatencyMs] = useState<number>(38);
  const [isStale, setIsStale] = useState<boolean>(false);
  const [priceFlash, setPriceFlash] = useState<'up' | 'down' | 'none'>('none');
  const [snapshot, setSnapshot] = useState<FullAnalysisResult | null>(null);
  const [aiReviewSnapshot, setAiReviewSnapshot] = useState<{ review: DeepSeekReview; reviewedPrice: number } | null>(null);
  const [indicatorSnapshot, setIndicatorSnapshot] = useState<FullAnalysisResult | null>(null);
  const [analysisSnapshot, setAnalysisSnapshot] = useState<FullAnalysisResult | null>(null);
  const [latestSourceSignals, setLatestSourceSignals] = useState<Partial<Record<SignalSource, SignalEntity>>>({});
  const [candles, setCandles] = useState<Candle[]>([]);
  const [candlesSymbol, setCandlesSymbol] = useState<string | null>(null);
  const [candlesTimeframe, setCandlesTimeframe] = useState<Timeframe | null>(null);
  const [language, setLanguage] = useState<'en' | 'km'>('en');
  const [activeTab, setActiveTab] = useState<string>('terminal');
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [isAskQraOpen, setIsAskQraOpen] = useState<boolean>(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState<boolean>(false);
  const [isAnalyzeRunning, setIsAnalyzeRunning] = useState<boolean>(false);
  const [analyzeStep, setAnalyzeStep] = useState<number>(0);
  const [wsConnected, setWsConnected] = useState<boolean>(false);

  const prevPriceRef = useRef<number>(currentPrice);
  const wsRef = useRef<WebSocket | null>(null);
  const activeMarketRef = useRef({ symbol: activeSymbol, timeframe: activeTimeframe });
  activeMarketRef.current = { symbol: activeSymbol, timeframe: activeTimeframe };

  const t = (_key: string, en: string, km: string) => (language === 'km' ? km : en);

  // Fetch initial snapshot and candles
  const refreshSnapshot = async () => {
    const requestedSymbol = activeSymbol;
    const requestedTimeframe = activeTimeframe;
    try {
      const res = await fetch(`/api/snapshot?symbol=${requestedSymbol}&timeframe=${requestedTimeframe}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          if (activeMarketRef.current.symbol !== requestedSymbol || activeMarketRef.current.timeframe !== requestedTimeframe) return;
          setSnapshot(json.data);
          setIndicatorSnapshot(json.indicatorData || null);
          setAnalysisSnapshot(json.analysisData || json.data);
          if (json.candles) {
            setCandles(json.candles);
            setCandlesSymbol(requestedSymbol);
            setCandlesTimeframe(requestedTimeframe);
          }
          if (json.data.currentPrice) {
            setCurrentPrice(json.data.currentPrice);
            setBid(json.data.bid);
            setAsk(json.data.ask);
            setSpread(json.data.spread);
            setIsStale(json.data.isStale);
          }
        }
      }
    } catch (e) {
      console.warn('Snapshot fetch error:', e);
    }
  };

  useEffect(() => {
    setAiReviewSnapshot(null);
    refreshSnapshot();
  }, [activeSymbol, activeTimeframe]);

  // Re-run the deterministic pipeline against the current forming bar so the
  // dashboard's live candidate and score track price, not only candle closes.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshSnapshot();
    }, 5000);
    return () => clearInterval(interval);
  }, [activeSymbol, activeTimeframe]);

  // Connect WebSocket for live ticks and heartbeat
  useEffect(() => {
    let reconnectTimeout: any = null;

    const connectWs = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'INIT' && msg.latestSourceSignals) {
            setLatestSourceSignals(msg.latestSourceSignals);
            if (msg.latestAiReview?.symbol === activeSymbol && msg.latestAiReview?.timeframe === activeTimeframe && msg.latestAiReview?.review) {
              setAiReviewSnapshot({ review: msg.latestAiReview.review, reviewedPrice: msg.latestAiReview.currentPrice });
            }
          } else if (msg.type === 'TICK' && msg.symbol === activeSymbol) {
            const newP = msg.price;
            if (newP > prevPriceRef.current) {
              setPriceFlash('up');
            } else if (newP < prevPriceRef.current) {
              setPriceFlash('down');
            }
            prevPriceRef.current = newP;
            setCurrentPrice(newP);
            setBid(msg.bid);
            setAsk(msg.ask);
            setSpread(msg.spread);
            setLatencyMs(msg.latencyMs);
            setIsStale(msg.isStale);

            setTimeout(() => setPriceFlash('none'), 800);
          } else if (msg.type === 'AI_REVIEW' && msg.symbol === activeSymbol && msg.timeframe === activeTimeframe && msg.review) {
            setAiReviewSnapshot({ review: msg.review, reviewedPrice: msg.currentPrice });
          } else if (msg.type === 'signal_created' && Array.isArray(msg.signals)) {
            setLatestSourceSignals((previous) => {
              const next = { ...previous };
              for (const signal of msg.signals as SignalEntity[]) next[signal.source] = signal;
              return next;
            });
          }
        } catch (e) {
          // ignore
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        reconnectTimeout = setTimeout(connectWs, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connectWs();

    // Heartbeat ping every 10s
    const pingInterval = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'PING' }));
      }
    }, 10000);

    return () => {
      clearInterval(pingInterval);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (wsRef.current) wsRef.current.close();
    };
  }, [activeSymbol, activeTimeframe]);

  // Keyboard shortcuts handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsAskQraOpen((prev) => !prev);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setIsDrawerOpen((prev) => !prev);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setActiveTab((prev) => (prev === 'terminal' ? 'chart' : 'terminal'));
      } else if ((e.metaKey || e.ctrlKey) && e.key === '?') {
        e.preventDefault();
        setIsShortcutsOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 12-Step Animated Pipeline Runner
  const runAnalysisWithAnimation = async () => {
    setIsDrawerOpen(true);
    setIsAnalyzeRunning(true);
    setAnalyzeStep(0);

    // Step by step animation through L1 to L12
    for (let i = 1; i <= 12; i++) {
      setAnalyzeStep(i);
      await new Promise((res) => setTimeout(res, 280));
    }

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: activeSymbol, timeframe: activeTimeframe }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setSnapshot(json.data);
          setAnalysisSnapshot(json.data);
          if (json.data.deepSeekReview) {
            setAiReviewSnapshot({ review: json.data.deepSeekReview, reviewedPrice: json.data.currentPrice });
          }
        }
      }
    } catch (e) {
      console.warn('Analyze call failed:', e);
    } finally {
      setIsAnalyzeRunning(false);
    }
  };

  return (
    <TerminalContext.Provider
      value={{
        activeSymbol,
        setActiveSymbol,
        activeTimeframe,
        setActiveTimeframe,
        currentPrice,
        bid,
        ask,
        spread,
        latencyMs,
        isStale,
        priceFlash,
        snapshot,
        aiReviewSnapshot,
        indicatorSnapshot,
        analysisSnapshot,
        latestSourceSignals,
        candles,
        candlesSymbol,
        candlesTimeframe,
        language,
        setLanguage,
        activeTab,
        setActiveTab,
        isDrawerOpen,
        setIsDrawerOpen,
        isAskQraOpen,
        setIsAskQraOpen,
        isShortcutsOpen,
        setIsShortcutsOpen,
        isAnalyzeRunning,
        analyzeStep,
        runAnalysisWithAnimation,
        refreshSnapshot,
        wsConnected,
        t,
      }}
    >
      {children}
    </TerminalContext.Provider>
  );
};

export const useTerminal = () => {
  const ctx = useContext(TerminalContext);
  if (!ctx) throw new Error('useTerminal must be used within TerminalProvider');
  return ctx;
};
