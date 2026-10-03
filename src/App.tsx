import React, { useEffect, useState } from 'react';
import { TerminalProvider, useTerminal } from './context/TerminalContext.tsx';
import { Header } from './components/Header.tsx';
import { SignalSourceStrip, StatusStrip } from './components/StatusStrip.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { IndicatorsPage } from './pages/IndicatorsPage.tsx';
import { TradingViewLivePage } from './pages/TradingViewLivePage.tsx';
import { DeskPage } from './pages/DeskPage.tsx';
import { OverviewPage } from './pages/OverviewPage.tsx';
import { SignalsPage } from './pages/SignalsPage.tsx';
import { PaperTradingPage } from './pages/PaperTradingPage.tsx';
import { ReplayBacktestPage } from './pages/ReplayBacktestPage.tsx';
import { SmcAcademyPage } from './pages/SmcAcademyPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { AskQraModal } from './components/AskQraModal.tsx';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal.tsx';

const TerminalContent: React.FC = () => {
  const { activeTab } = useTerminal();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMobileMenuOpen(false);
    };
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setIsMobileMenuOpen(false);
    };
    const desktopQuery = window.matchMedia('(min-width: 1024px)');
    window.addEventListener('keydown', closeOnEscape);
    desktopQuery.addEventListener('change', closeOnDesktop);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      desktopQuery.removeEventListener('change', closeOnDesktop);
    };
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#07090d] text-slate-100 select-none">
      {/* Top Header */}
      <Header
        mobileMenuOpen={isMobileMenuOpen}
        onMenuClick={() => setIsMobileMenuOpen((open) => !open)}
      />

      {/* Real-time Status Ribbon */}
      <StatusStrip />
      <SignalSourceStrip />

      {/* Main Workspace: Left Sidebar + Active Page */}
      <div className="relative flex-1 flex overflow-hidden">
        {isMobileMenuOpen && (
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setIsMobileMenuOpen(false)}
            className="absolute inset-0 z-30 bg-black/65 backdrop-blur-[1px] lg:hidden"
          />
        )}
        <Sidebar
          mobileOpen={isMobileMenuOpen}
          onNavigate={() => setIsMobileMenuOpen(false)}
        />

        <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
          {activeTab === 'terminal' && <IndicatorsPage />}
          {activeTab === 'chart' && <TradingViewLivePage />}
          {activeTab === 'desk' && <DeskPage />}
          {activeTab === 'overview' && <OverviewPage />}
          {activeTab === 'signals' && <SignalsPage />}
          {activeTab === 'trades' && <PaperTradingPage />}
          {activeTab === 'backtest' && <ReplayBacktestPage />}
          {activeTab === 'academy' && <SmcAcademyPage />}
          {activeTab === 'settings' && <SettingsPage />}

          {/* Bottom Risk Guard Disclaimer Strip */}
          <footer className="h-6 bg-[#06080b] border-t border-white/[0.04] px-4 flex items-center justify-between text-[10px] font-mono text-slate-500 shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>QRA Institutional SMC/ICT Terminal</span>
              <span>·</span>
              <span>XAUUSD Gold Microstructure</span>
            </div>
            <div className="text-slate-600">
              Quantitative advisory only. Not financial advice. Strict risk management required.
            </div>
          </footer>
        </main>
      </div>

      {/* Interactive Global Modals */}
      <AskQraModal />
      <KeyboardShortcutsModal />
    </div>
  );
};

export default function App() {
  return (
    <TerminalProvider>
      <TerminalContent />
    </TerminalProvider>
  );
}
