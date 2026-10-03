import React from 'react';
import { useTerminal } from '../context/TerminalContext.tsx';
import { Timeframe } from '../types.ts';
import { Activity, AlertTriangle, Clock, Globe, HelpCircle, Menu, ShieldAlert, Sparkles, Wifi, X } from 'lucide-react';

const SYMBOLS = [
  { id: 'XAUUSD', label: 'XAUUSD', name: 'Gold' },
  { id: 'BTCUSDT', label: 'BTCUSDT', name: 'Bitcoin' },
  { id: 'EURUSD', label: 'EURUSD', name: 'Euro' },
  { id: 'GBPUSD', label: 'GBPUSD', name: 'Pound' },
  { id: 'US30', label: 'US30', name: 'Dow 30' },
  { id: 'NAS100', label: 'NAS100', name: 'Nasdaq' },
  { id: 'USOIL', label: 'USOIL', name: 'Crude' },
];

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', 'D'];

export const Header: React.FC<{ mobileMenuOpen: boolean; onMenuClick: () => void }> = ({ mobileMenuOpen, onMenuClick }) => {
  const {
    activeSymbol,
    setActiveSymbol,
    activeTimeframe,
    setActiveTimeframe,
    currentPrice,
    spread,
    latencyMs,
    isStale,
    priceFlash,
    snapshot,
    language,
    setLanguage,
    setIsAskQraOpen,
    setIsShortcutsOpen,
    runAnalysisWithAnimation,
    t,
  } = useTerminal();

  // Session pill formatting
  const session = snapshot?.session;
  let sessionLabel = 'ASIA BUILD';
  let sessionColor = 'bg-blue-500/10 text-cyan-400 border-cyan-500/20';

  if (session?.isRolloverBlocked) {
    sessionLabel = 'ROLLOVER (HALT)';
    sessionColor = 'bg-red-500/20 text-red-400 border-red-500/40 animate-pulse';
  } else if (session?.currentSession === 'OVERLAP') {
    sessionLabel = 'LON / NY OVERLAP';
    sessionColor = 'bg-[#F5C451]/15 text-[#F5C451] border-[#F5C451]/30';
  } else if (session?.currentSession === 'LONDON') {
    sessionLabel = session.isKillZone ? '⚡ LONDON KILLZONE' : 'LONDON SESSION';
    sessionColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
  } else if (session?.currentSession === 'NY') {
    sessionLabel = session.isKillZone ? '⚡ NY KILLZONE' : 'NEW YORK';
    sessionColor = 'bg-purple-500/10 text-purple-300 border-purple-500/30';
  } else if (session?.currentSession === 'ASIA') {
    sessionLabel = 'ASIA BUILD';
    sessionColor = 'bg-blue-500/10 text-cyan-400 border-cyan-500/20';
  }

  // Market verdict headline
  const verdictText =
    snapshot?.regime.type === 'RANGE'
      ? t('verdict_range', 'SIDEWAYS · No A+ setup — wait for the dealing range box to resolve', 'ចលនាផ្ដេក (SIDEWAYS) · គ្មាន A+ — រង់ចាំការបំបែក Range')
      : snapshot?.verdict === 'BUY'
      ? t('verdict_buy', 'BULLISH MOMENTUM · Look for Discount Order Blocks & FVG entries', 'និន្នាការឡើងខ្លាំង · រង់ចាំចូល Discount OB & FVG')
      : snapshot?.verdict === 'SELL'
      ? t('verdict_sell', 'BEARISH DISPLACEMENT · Target Premium Liquidity Purges', 'និន្នាការចុះខ្លាំង · រង់ចាំចូល Premium Rejection')
      : t('verdict_wait', 'EQUILIBRIUM · Scanning for institutional liquidity sweeps', 'រង់ចាំ · កំពុងតាមដាន Liquidity Sweeps របស់ធនាគារ');

  return (
    <header className="h-14 bg-[#07090d] border-b border-white/[0.07] px-2 sm:px-4 flex items-center justify-between gap-1 sm:gap-4 select-none shrink-0 z-30">
      {/* Left: Brand & Live Price Flash */}
      <div className="flex items-center gap-2 sm:gap-3.5 min-w-0">
        <button
          type="button"
          onClick={onMenuClick}
          className="lg:hidden flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/[0.08] text-slate-300 hover:bg-white/[0.06] hover:text-[#F5C451] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F5C451]"
          aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-controls="primary-sidebar"
          aria-expanded={mobileMenuOpen}
          title={mobileMenuOpen ? 'Close menu' : 'Menu'}
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#F5C451] via-[#E1A729] to-[#8C6400] flex items-center justify-center shadow-lg shadow-[#F5C451]/10">
            <span className="font-mono font-bold text-black text-xs tracking-tighter">QRA</span>
          </div>
          <div className="hidden sm:block">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold tracking-wider text-slate-100 font-mono">JD QRA TERMINAL</span>
              <span className="text-[10px] px-1 py-0.2 rounded font-mono bg-[#F5C451]/15 text-[#F5C451] border border-[#F5C451]/30">
                PRO
              </span>
            </div>
            <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 beacon-pulse"></span>
              <span>SMC · ICT CORE</span>
            </div>
          </div>
        </div>

        {/* Live Gold Price Pill */}
        <div
          className={`hidden sm:flex items-center gap-2 px-3 py-1 rounded-md border font-mono transition-colors duration-300 ${
            priceFlash === 'up'
              ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
              : priceFlash === 'down'
              ? 'bg-rose-500/20 border-rose-500/50 text-rose-300'
              : 'bg-white/[0.03] border-white/[0.08] text-slate-100'
          }`}
        >
          <span className="text-[11px] text-slate-400 font-sans">{activeSymbol}</span>
          <span className="text-sm font-semibold tracking-tight">
            {currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-[10px] text-slate-400">sp: ${spread}</span>
        </div>

        {/* Session Status Pill */}
        <div className={`hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-mono font-medium ${sessionColor}`}>
          <span>{sessionLabel}</span>
          <span className="text-slate-400 text-[10px]">
            ({session?.closesInUtc} · {Math.floor((session?.closesInMinutes || 0) / 60)}h {(session?.closesInMinutes || 0) % 60}m)
          </span>
        </div>

        {/* Market Verdict Banner */}
        <div className="hidden xl:flex items-center gap-1.5 px-3 py-1 rounded-md bg-white/[0.02] border border-white/[0.06] text-xs text-slate-300 max-w-md truncate">
          <Activity className="w-3.5 h-3.5 text-[#F5C451] shrink-0" />
          <span className="truncate">{verdictText}</span>
        </div>
      </div>

      {/* Middle: Symbol Tabs & Timeframe Tabs */}
      <div className="hidden lg:flex items-center gap-2">
        {/* Symbol Selector Tabs */}
        <div className="flex items-center bg-white/[0.02] p-0.5 rounded-lg border border-white/[0.06]">
          {SYMBOLS.slice(0, 4).map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSymbol(s.id)}
              className={`px-2.5 py-1 rounded text-xs font-mono transition-all ${
                activeSymbol === s.id
                  ? 'bg-[#F5C451] text-black font-semibold shadow-sm shadow-[#F5C451]/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Timeframe Selector Tabs */}
        <div className="flex items-center bg-white/[0.02] p-0.5 rounded-lg border border-white/[0.06]">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => setActiveTimeframe(tf)}
              className={`px-2 py-1 rounded text-xs font-mono transition-all ${
                activeTimeframe === tf
                  ? 'bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Compact selectors keep symbol and timeframe controls available on phones. */}
      <div className="flex lg:hidden items-center gap-1 shrink-0">
        <select
          value={activeSymbol}
          onChange={(event) => setActiveSymbol(event.target.value)}
          aria-label="Select symbol"
          className="h-9 w-[68px] rounded border border-white/[0.08] bg-[#10151d] px-1 text-[10px] font-mono text-slate-200"
        >
          {SYMBOLS.map((symbol) => <option key={symbol.id} value={symbol.id}>{symbol.label}</option>)}
        </select>
        <select
          value={activeTimeframe}
          onChange={(event) => setActiveTimeframe(event.target.value as Timeframe)}
          aria-label="Select timeframe"
          className="h-9 w-[50px] rounded border border-white/[0.08] bg-[#10151d] px-1 text-[10px] font-mono text-slate-200"
        >
          {TIMEFRAMES.map((timeframe) => <option key={timeframe} value={timeframe}>{timeframe}</option>)}
        </select>
      </div>

      {/* Right: Latency, Stale Guard, AI & Lang controls */}
      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        {/* Stale Data Warning or Live Latency */}
        {isStale ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-500/20 border border-rose-500/50 text-rose-300 text-xs font-mono font-bold animate-pulse">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            <span className="hidden sm:inline">DATA STALE</span>
          </div>
        ) : (
          <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded bg-white/[0.02] border border-white/[0.05] text-[11px] font-mono text-slate-400">
            <Wifi className="w-3 h-3 text-emerald-400" />
            <span>{latencyMs}ms</span>
          </div>
        )}

        {/* Quick Analyze Button */}
        <button
          onClick={runAnalysisWithAnimation}
          className="flex h-10 sm:h-auto items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-md bg-[#F5C451]/10 hover:bg-[#F5C451]/20 border border-[#F5C451]/30 text-[#F5C451] text-xs font-mono font-medium transition-all shadow-sm"
          title={t('analyze', 'Analyze', 'វិភាគ')}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{t('analyze', 'Analyze', 'វិភាគ')}</span>
        </button>

        {/* Ask QRA AI button */}
        <button
          onClick={() => setIsAskQraOpen(true)}
          className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.08] text-slate-300 text-xs font-mono transition-all"
          title="Ask QRA (⌘F)"
        >
          <span className="text-[#3DDCFF] font-semibold">QRA AI</span>
          <span className="text-[10px] text-slate-400 bg-white/5 px-1 rounded">⌘F</span>
        </button>

        {/* Language Toggle */}
        <button
          onClick={() => setLanguage(language === 'en' ? 'km' : 'en')}
          className="flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.08] text-[10px] sm:text-xs font-mono text-slate-300 transition-all"
          title="Toggle Khmer / English"
        >
          <Globe className="w-3.5 h-3.5 text-slate-400" />
          <span className="font-bold">{language === 'en' ? 'EN' : 'ខ្មែរ'}</span>
        </button>

        {/* Shortcuts button */}
        <button
          onClick={() => setIsShortcutsOpen(true)}
          className="hidden md:block p-1.5 rounded hover:bg-white/[0.05] text-slate-400 hover:text-slate-200 transition-colors"
          title="Shortcuts (⌘?)"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
