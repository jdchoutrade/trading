import React from 'react';
import { useTerminal } from '../context/TerminalContext.tsx';
import {
  BarChart3,
  BookOpen,
  CandlestickChart,
  History,
  LayoutDashboard,
  PlayCircle,
  Radio,
  Settings,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';

export const Sidebar: React.FC<{ mobileOpen: boolean; onNavigate: () => void }> = ({ mobileOpen, onNavigate }) => {
  const { activeTab, setActiveTab, t, snapshot } = useTerminal();

  const navItems: Array<{ id: string; label: string; icon: any; badge?: string; count?: number }> = [
    { id: 'terminal', label: t('nav_terminal', 'Terminal', 'Indicators'), icon: CandlestickChart, badge: 'SMC' },
    { id: 'chart', label: t('nav_chart', 'Live Chart', 'Lightweight'), icon: BarChart3 },
    { id: 'desk', label: t('nav_desk', 'Desk & Macro', 'តុជួញដូរ Macro'), icon: LayoutDashboard, badge: 'V2' },
    { id: 'overview', label: t('nav_overview', 'Overview', 'ទិដ្ឋភាពទូទៅ'), icon: Radio },
    { id: 'signals', label: t('nav_signals', 'History', 'ប្រវត្តិ Signal & Outcomes'), icon: History, badge: 'Tracked' },
    { id: 'trades', label: t('nav_trades', 'Paper Trades', 'ការជួញដូរសាកល្បង'), icon: TrendingUp },
    { id: 'backtest', label: t('nav_backtest', 'Replay / Backtest', 'ការធ្វើតេស្ត Replay'), icon: PlayCircle },
    { id: 'academy', label: t('nav_academy', 'SMC Academy', 'មេរៀន SMC/ICT'), icon: BookOpen },
    { id: 'settings', label: t('nav_settings', 'Settings', 'ការកំណត់'), icon: Settings },
  ];

  return (
    <aside id="primary-sidebar" className={`absolute inset-y-0 left-0 w-64 bg-[#080b10] border-r border-white/[0.06] flex flex-col justify-between shrink-0 select-none z-40 transition-transform duration-200 ease-out lg:relative lg:inset-auto lg:z-20 lg:w-56 ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
      {/* Navigation list */}
      <div className="p-2 space-y-1">
        <div className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-400">
          Navigation
        </div>

        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id);
                onNavigate();
              }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-mono transition-all group ${
                isActive
                  ? 'bg-[#F5C451]/10 text-[#F5C451] font-semibold border border-[#F5C451]/25'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Icon className={`w-4 h-4 transition-colors ${isActive ? 'text-[#F5C451]' : 'text-slate-400 group-hover:text-slate-300'}`} />
                <span>{item.label}</span>
              </div>

              {item.badge && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  {item.badge}
                </span>
              )}

              {item.count !== undefined && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/[0.04] text-slate-400">
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom Quantitative System Status */}
      <div className="p-3 border-t border-white/[0.06] bg-black/20 text-xs font-mono space-y-2">
        <div className="flex items-center justify-between text-slate-400 text-[11px]">
          <span>FEED ENGINE</span>
          <span className="text-emerald-400 flex items-center gap-1 font-semibold">
            <Radio className="w-3 h-3 animate-pulse" />
            LIVE
          </span>
        </div>

        <div className="bg-white/[0.02] p-2 rounded border border-white/[0.04] space-y-1">
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>Regime Model:</span>
            <span className="text-slate-200 font-semibold">{snapshot?.regime.type.replace('TREND_', '') || 'RANGE'}</span>
          </div>
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>Risk Guard:</span>
            <span className="text-cyan-400 font-semibold">1.5R Min</span>
          </div>
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>Circuit Breaker:</span>
            <span className="text-emerald-400 font-semibold">READY</span>
          </div>
        </div>

        <div className="text-[9px] text-slate-400 text-center leading-tight">
          QRA Quantitative Architecture v2.5
        </div>
      </div>
    </aside>
  );
};
