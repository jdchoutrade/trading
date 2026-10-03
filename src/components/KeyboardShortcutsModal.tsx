import React from 'react';
import { useTerminal } from '../context/TerminalContext.tsx';
import { Command, HelpCircle, X } from 'lucide-react';

export const KeyboardShortcutsModal: React.FC = () => {
  const { isShortcutsOpen, setIsShortcutsOpen } = useTerminal();

  if (!isShortcutsOpen) return null;

  const shortcuts = [
    { key: '⌘ / Ctrl + F', desc: 'Open Ask QRA AI Assistant' },
    { key: '⌘ / Ctrl + S', desc: 'Open 12-Step Quant Setup Plan Drawer' },
    { key: '⌘ / Ctrl + B', desc: 'Toggle Between Indicators & Live Chart' },
    { key: '⌘ / Ctrl + ?', desc: 'Open Keyboard Shortcuts Reference' },
  ];

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#090d14] border border-white/[0.08] rounded-2xl shadow-2xl p-5 font-mono text-xs animate-in fade-in zoom-in-95 duration-200 space-y-4">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
          <div className="flex items-center gap-2">
            <Command className="w-4 h-4 text-[#F5C451]" />
            <span className="font-bold text-slate-100">KEYBOARD SHORTCUTS</span>
          </div>
          <button
            onClick={() => setIsShortcutsOpen(false)}
            className="p-1 rounded hover:bg-white/[0.08] text-slate-400 hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2">
          {shortcuts.map((s, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-2.5 rounded bg-white/[0.02] border border-white/[0.04]"
            >
              <span className="text-slate-300">{s.desc}</span>
              <kbd className="px-2 py-0.8 rounded bg-black/40 border border-white/[0.1] text-[#F5C451] font-bold text-[11px]">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>

        <p className="text-[10px] text-slate-500 text-center pt-2">
          Institutional terminal shortcuts optimize live execution efficiency.
        </p>
      </div>
    </div>
  );
};
