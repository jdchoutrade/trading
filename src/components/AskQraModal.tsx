import React, { useState } from 'react';
import { useTerminal } from '../context/TerminalContext.tsx';
import { Bot, Send, Sparkles, User, X } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const AskQraModal: React.FC = () => {
  const { isAskQraOpen, setIsAskQraOpen, activeSymbol, activeTimeframe, snapshot, t } = useTerminal();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Hello! I am QRA, your Smart Money Concepts & Institutional Microstructure Quant Architect. Ask me anything about current technical levels, order blocks, killzones, or risk invalidation for XAUUSD.',
    },
  ]);
  const [input, setInput] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  if (!isAskQraOpen) return null;

  const handleSend = async (queryText?: string) => {
    const textToSend = queryText || input;
    if (!textToSend.trim() || loading) return;

    const userMsg: ChatMessage = { role: 'user', content: textToSend };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: textToSend,
          symbol: activeSymbol,
          timeframe: activeTimeframe,
          history: messages.slice(-4),
        }),
      });
      const data = await res.json();
      if (data.success && data.reply) {
        setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
      }
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Connection error while communicating with QRA engine.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const quickQuestions = [
    'What is the current H1 bias & regime?',
    'Why is the engine currently in WAIT mode?',
    'Where is the best unmitigated Order Block?',
    'តើមានឱកាស Buy លើ Gold ពេលនេះដែរឬទេ?',
  ];

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#090d14] border border-white/[0.08] rounded-2xl shadow-2xl flex flex-col h-[580px] overflow-hidden font-mono animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-4 border-b border-white/[0.08] bg-[#0d121c] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#3DDCFF]/10 border border-[#3DDCFF]/20 flex items-center justify-center">
              <Bot className="w-4 h-4 text-[#3DDCFF]" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-100">ASK QRA QUANTITATIVE ARCHITECT</span>
                <span className="text-[10px] px-1 py-0.2 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  AI Context Aware
                </span>
              </div>
              <span className="text-[10px] text-slate-400">
                Target: {activeSymbol} ({activeTimeframe}) · Price ${snapshot?.currentPrice || 2650}
              </span>
            </div>
          </div>

          <button
            onClick={() => setIsAskQraOpen(false)}
            className="p-1.5 rounded hover:bg-white/[0.08] text-slate-400 hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Chat message history */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex gap-2.5 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {m.role === 'assistant' && (
                <div className="w-6 h-6 rounded-md bg-[#F5C451]/10 border border-[#F5C451]/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles className="w-3 h-3 text-[#F5C451]" />
                </div>
              )}

              <div
                className={`max-w-[85%] p-3 rounded-xl leading-relaxed whitespace-pre-line ${
                  m.role === 'user'
                    ? 'bg-[#F5C451] text-black font-semibold shadow-md'
                    : 'bg-[#0f141f] border border-white/[0.06] text-slate-200'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-2.5 items-center text-xs text-slate-400">
              <div className="w-6 h-6 rounded-md bg-white/[0.04] flex items-center justify-center animate-pulse">
                <Sparkles className="w-3 h-3 text-cyan-400" />
              </div>
              <span>QRA is calculating order flow & liquidity maps...</span>
            </div>
          )}
        </div>

        {/* Quick prompt suggestions */}
        <div className="px-4 py-2 bg-black/20 border-t border-white/[0.04] flex gap-2 overflow-x-auto whitespace-nowrap">
          {quickQuestions.map((q, idx) => (
            <button
              key={idx}
              onClick={() => handleSend(q)}
              className="text-[10px] px-2.5 py-1 rounded bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] text-slate-300 transition-all shrink-0"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <div className="p-3 border-t border-white/[0.08] bg-[#0d121c] flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask QRA anything about Gold microstructure (Khmer or English)..."
            className="flex-1 bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-slate-100 outline-none focus:border-[#F5C451]/50 transition-colors"
          />
          <button
            onClick={() => handleSend()}
            disabled={loading || !input.trim()}
            className="p-2 rounded-lg bg-[#F5C451] hover:bg-[#e0b03e] text-black transition-all disabled:opacity-40"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
