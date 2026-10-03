import React, { useEffect, useState } from 'react';
import { useTerminal } from '../context/TerminalContext.tsx';
import { PaperTrade } from '../types.ts';
import {
  ArrowDownRight,
  ArrowUpRight,
  Calculator,
  CheckCircle,
  Clock,
  DollarSign,
  PlusCircle,
  ShieldCheck,
  Trash2,
  TrendingUp,
} from 'lucide-react';

export const PaperTradingPage: React.FC = () => {
  const { currentPrice, activeSymbol, snapshot } = useTerminal();
  const [balance, setBalance] = useState<number>(10000);
  const [trades, setTrades] = useState<PaperTrade[]>([]);

  // Calculator inputs
  const [accountSize, setAccountSize] = useState<number>(10000);
  const [riskPercent, setRiskPercent] = useState<number>(1.0);
  const [orderType, setOrderType] = useState<'BUY' | 'SELL'>('BUY');
  const [entryPrice, setEntryPrice] = useState<number>(currentPrice);
  const [slPrice, setSlPrice] = useState<number>(Number((currentPrice - 6.0).toFixed(2)));
  const [tpPrice, setTpPrice] = useState<number>(Number((currentPrice + 12.0).toFixed(2)));

  // Sync entry price when switching
  useEffect(() => {
    setEntryPrice(currentPrice);
    if (orderType === 'BUY') {
      setSlPrice(Number((currentPrice - 6.0).toFixed(2)));
      setTpPrice(Number((currentPrice + 12.0).toFixed(2)));
    } else {
      setSlPrice(Number((currentPrice + 6.0).toFixed(2)));
      setTpPrice(Number((currentPrice - 12.0).toFixed(2)));
    }
  }, [orderType, currentPrice]);

  // Load paper trades
  const loadTrades = async () => {
    try {
      const res = await fetch('/api/paper-trades');
      const data = await res.json();
      if (data.success) {
        setTrades(data.trades || []);
        if (data.balance) setBalance(data.balance);
      }
    } catch (e) {
      console.warn('Failed to load trades:', e);
    }
  };

  useEffect(() => {
    loadTrades();
  }, []);

  // Risk Calculations
  const riskDollar = (accountSize * riskPercent) / 100;
  const slDistance = Math.max(0.1, Math.abs(entryPrice - slPrice));
  const calculatedLotSize = Number((riskDollar / (slDistance * 100)).toFixed(2));
  const tpDistance = Math.abs(tpPrice - entryPrice);
  const riskReward = (tpDistance / slDistance).toFixed(2);

  const handlePlaceTrade = async () => {
    const newTrade: Partial<PaperTrade> = {
      symbol: activeSymbol,
      direction: orderType,
      entryPrice,
      currentPrice,
      stopLoss: slPrice,
      takeProfit: tpPrice,
      lotSize: Math.max(0.01, calculatedLotSize),
    };

    try {
      const res = await fetch('/api/paper-trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTrade),
      });
      const data = await res.json();
      if (data.success) {
        loadTrades();
      }
    } catch (e) {
      console.warn('Trade placement error:', e);
    }
  };

  const handleCloseTrade = async (id: string) => {
    try {
      const res = await fetch('/api/paper-trades/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, currentPrice }),
      });
      const data = await res.json();
      if (data.success) {
        loadTrades();
      }
    } catch (e) {
      console.warn('Close trade error:', e);
    }
  };

  const openTrades = trades.filter((t) => t.status === 'OPEN');
  const closedTrades = trades.filter((t) => t.status === 'CLOSED');

  return (
    <div className="flex-1 bg-[#07090d] p-5 space-y-5 overflow-y-auto select-none font-mono">
      {/* Account Balance Strip */}
      <div className="bg-[#0b0f17] border border-white/[0.06] rounded-xl p-4 shadow-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <DollarSign className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">PAPER TRADING EQUITY</span>
            <span className="text-2xl font-bold text-slate-100">${balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <div>
            <span className="text-slate-500 text-[10px] block">Open Positions:</span>
            <span className="text-cyan-400 font-bold">{openTrades.length}</span>
          </div>
          <div>
            <span className="text-slate-500 text-[10px] block">Completed Trades:</span>
            <span className="text-slate-300 font-bold">{closedTrades.length}</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Risk Management Calculator & Order Placement */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: Calculator & Trade Executor */}
        <div className="bg-[#0b0f17] border border-white/[0.06] rounded-xl p-4 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
            <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <Calculator className="w-4 h-4 text-[#F5C451]" />
              POSITION SIZE & RISK ENGINE
            </span>
            <span className="text-[10px] text-slate-500">Fixed Fractional Model</span>
          </div>

          {/* Direction toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setOrderType('BUY')}
              className={`py-2 rounded-md font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                orderType === 'BUY'
                  ? 'bg-emerald-500 text-black shadow-md shadow-emerald-500/20'
                  : 'bg-white/[0.03] text-slate-400 hover:text-slate-200'
              }`}
            >
              <ArrowUpRight className="w-3.5 h-3.5" />
              BUY (Long)
            </button>
            <button
              onClick={() => setOrderType('SELL')}
              className={`py-2 rounded-md font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                orderType === 'SELL'
                  ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20'
                  : 'bg-white/[0.03] text-slate-400 hover:text-slate-200'
              }`}
            >
              <ArrowDownRight className="w-3.5 h-3.5" />
              SELL (Short)
            </button>
          </div>

          {/* Inputs */}
          <div className="space-y-3 text-xs">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Account Balance ($)</label>
              <input
                type="number"
                value={accountSize}
                onChange={(e) => setAccountSize(Number(e.target.value))}
                className="w-full bg-black/40 border border-white/[0.08] rounded px-3 py-1.5 text-slate-100 outline-none"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>Risk Percentage (%)</span>
                <span className="text-[#F5C451] font-bold">${riskDollar.toFixed(2)} Risk</span>
              </div>
              <input
                type="number"
                step="0.1"
                value={riskPercent}
                onChange={(e) => setRiskPercent(Number(e.target.value))}
                className="w-full bg-black/40 border border-white/[0.08] rounded px-3 py-1.5 text-slate-100 outline-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Entry Price</label>
                <input
                  type="number"
                  step="0.1"
                  value={entryPrice}
                  onChange={(e) => setEntryPrice(Number(e.target.value))}
                  className="w-full bg-black/40 border border-white/[0.08] rounded px-2 py-1 text-slate-100 outline-none text-xs"
                />
              </div>

              <div>
                <label className="text-[10px] text-rose-400 block mb-1">Stop Loss (SL)</label>
                <input
                  type="number"
                  step="0.1"
                  value={slPrice}
                  onChange={(e) => setSlPrice(Number(e.target.value))}
                  className="w-full bg-black/40 border border-white/[0.08] rounded px-2 py-1 text-rose-300 outline-none text-xs"
                />
              </div>

              <div>
                <label className="text-[10px] text-emerald-400 block mb-1">Take Profit (TP)</label>
                <input
                  type="number"
                  step="0.1"
                  value={tpPrice}
                  onChange={(e) => setTpPrice(Number(e.target.value))}
                  className="w-full bg-black/40 border border-white/[0.08] rounded px-2 py-1 text-emerald-300 outline-none text-xs"
                />
              </div>
            </div>
          </div>

          {/* Computed Metrics */}
          <div className="bg-black/30 p-3 rounded-lg border border-white/[0.04] space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">SL Distance:</span>
              <span className="text-slate-200 font-semibold">{slDistance.toFixed(2)} pts</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Calculated Lot Size:</span>
              <span className="text-[#F5C451] font-bold">{calculatedLotSize} lots</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Risk-to-Reward:</span>
              <span className={Number(riskReward) >= 1.5 ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                1 : {riskReward}R
              </span>
            </div>
          </div>

          <button
            onClick={handlePlaceTrade}
            className="w-full py-2.5 rounded-md bg-[#F5C451] hover:bg-[#e0b03e] text-black font-bold text-xs shadow-md shadow-[#F5C451]/20 transition-all flex items-center justify-center gap-1.5"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Open Paper Trade ({calculatedLotSize} Lots)</span>
          </button>
        </div>

        {/* Right: Active Open Positions & Trade History */}
        <div className="lg:col-span-2 space-y-4">
          {/* Open Positions */}
          <div className="bg-[#0b0f17] border border-white/[0.06] rounded-xl overflow-hidden shadow-lg">
            <div className="p-3 border-b border-white/[0.06] flex items-center justify-between text-xs font-bold text-slate-200">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 beacon-pulse" />
                <span>ACTIVE POSITIONS ({openTrades.length})</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] text-slate-400 text-[10px] bg-white/[0.01]">
                    <th className="py-2.5 px-3">Symbol / Dir</th>
                    <th className="py-2.5 px-3">Entry</th>
                    <th className="py-2.5 px-3">Live Price</th>
                    <th className="py-2.5 px-3">SL / TP</th>
                    <th className="py-2.5 px-3">Lots</th>
                    <th className="py-2.5 px-3">Floating P&L</th>
                    <th className="py-2.5 px-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {openTrades.map((t) => {
                    const diff = t.direction === 'BUY' ? currentPrice - t.entryPrice : t.entryPrice - currentPrice;
                    const pnl = Number((diff * t.lotSize * 100).toFixed(2));
                    return (
                      <tr key={t.id} className="hover:bg-white/[0.02]">
                        <td className="py-2.5 px-3">
                          <span className="font-bold text-slate-100">{t.symbol}</span>
                          <span
                            className={`ml-1.5 px-1 rounded text-[10px] font-bold ${
                              t.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {t.direction}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">{t.entryPrice.toFixed(2)}</td>
                        <td className="py-2.5 px-3 text-slate-100 font-semibold">{currentPrice.toFixed(2)}</td>
                        <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                          {t.stopLoss.toFixed(2)} / {t.takeProfit.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-slate-200">{t.lotSize}</td>
                        <td className="py-2.5 px-3 font-bold">
                          <span className={pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {pnl >= 0 ? `+$${pnl}` : `-$${Math.abs(pnl)}`}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <button
                            onClick={() => handleCloseTrade(t.id)}
                            className="px-2 py-0.5 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[10px]"
                          >
                            Close
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {openTrades.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-500 text-xs">
                        No active open positions. Use the position calculator to execute a trade.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Live Trade Tracker: Spread-aware lifecycle */}
          <div className="bg-[#0b0f17] border border-white/[0.06] rounded-xl overflow-hidden shadow-lg">
            <div className="p-3 border-b border-white/[0.06] flex items-center justify-between text-xs font-bold text-slate-200">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-cyan-400" />
                <span>SPREAD-AWARE LIVE TRADE TRACKER & TIME STOPS</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                Multi-Stage: Triggered → TP1 → BE Trailed → TP2
              </span>
            </div>

            <div className="p-3 space-y-2 text-xs">
              <div className="bg-black/30 p-2.5 rounded-lg border border-white/[0.04] flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-bold text-slate-200">XAUUSD Active Lifecycle Guard</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  Current Spread: <span className="text-[#F5C451] font-bold">${(snapshot?.spread || 0.35).toFixed(2)}</span> · Invalidation Buffer: <span className="text-cyan-400 font-bold">+0.15 pts</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-1">
                <div className="bg-white/[0.02] p-2 rounded border border-white/[0.04]">
                  <span className="text-[10px] text-slate-500 block">Stage 1: Entry Trigger</span>
                  <span className="font-semibold text-emerald-400 text-[11px]">Spread-Adjusted (Ask/Bid)</span>
                </div>
                <div className="bg-white/[0.02] p-2 rounded border border-white/[0.04]">
                  <span className="text-[10px] text-slate-500 block">Stage 2: TP1 Reached</span>
                  <span className="font-semibold text-[#F5C451] text-[11px]">Auto Trailing SL to BE</span>
                </div>
                <div className="bg-white/[0.02] p-2 rounded border border-white/[0.04]">
                  <span className="text-[10px] text-slate-500 block">Stage 3: TP2 Runner</span>
                  <span className="font-semibold text-cyan-400 text-[11px]">Structural Trail (M15 HL/LH)</span>
                </div>
                <div className="bg-white/[0.02] p-2 rounded border border-white/[0.04]">
                  <span className="text-[10px] text-slate-500 block">Stage 4: Time Stop</span>
                  <span className="font-semibold text-rose-400 text-[11px]">Close at 21:45 UTC (Rollover)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Trade History */}
          <div className="bg-[#0b0f17] border border-white/[0.06] rounded-xl overflow-hidden shadow-lg">
            <div className="p-3 border-b border-white/[0.06] text-xs font-bold text-slate-200">
              TRADE JOURNAL HISTORY ({closedTrades.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] text-slate-400 text-[10px] bg-white/[0.01]">
                    <th className="py-2.5 px-3">Symbol</th>
                    <th className="py-2.5 px-3">Direction</th>
                    <th className="py-2.5 px-3">Entry</th>
                    <th className="py-2.5 px-3">Lots</th>
                    <th className="py-2.5 px-3">Realized PnL</th>
                    <th className="py-2.5 px-3">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {closedTrades.map((t) => (
                    <tr key={t.id} className="hover:bg-white/[0.02]">
                      <td className="py-2.5 px-3 font-semibold text-slate-200">{t.symbol}</td>
                      <td className="py-2.5 px-3">
                        <span className={t.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}>
                          {t.direction}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">{t.entryPrice.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-slate-400">{t.lotSize}</td>
                      <td className="py-2.5 px-3 font-bold">
                        <span className={t.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {t.pnl >= 0 ? `+$${t.pnl}` : `-$${Math.abs(t.pnl)}`}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-400 text-[10px]">{t.closeReason}</td>
                    </tr>
                  ))}
                  {closedTrades.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-slate-500 text-xs">
                        No closed trades recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
