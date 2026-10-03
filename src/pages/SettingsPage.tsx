import React, { useEffect, useState } from 'react';
import { useTerminal } from '../context/TerminalContext.tsx';
import {
  Bot,
  CheckCircle,
  Key,
  Layers,
  Save,
  Send,
  Settings as SettingsIcon,
  Sliders,
} from 'lucide-react';

export const SettingsPage: React.FC = () => {
  const { language, setLanguage, t } = useTerminal();
  type SourceConfig = {
    version: string;
    enabled: boolean;
    minScore: number;
    minGrade: 'A+' | 'A' | 'B';
    cooldownSeconds: number;
    minimumTechnicalPasses: number;
    weights: Record<'TREND' | 'RANGE' | 'HIGH_VOLATILITY', Record<string, number>>;
  };
  const [sourceConfigs, setSourceConfigs] = useState<Record<'INDICATOR' | 'ANALYSIS', SourceConfig> | null>(null);
  const [sourceConfigStatus, setSourceConfigStatus] = useState<string | null>(null);

  // Telegram settings
  const [telegramToken, setTelegramToken] = useState<string>('');
  const [telegramChatId, setTelegramChatId] = useState<string>('');
  const [telegramTestStatus, setTelegramTestStatus] = useState<string | null>(null);

  // AI settings
  const [deepseekKey, setDeepseekKey] = useState<string>('');
  const [aiModel, setAiModel] = useState<string>('deepseek-chat');

  // Independent weight matrices
  const [weightSource, setWeightSource] = useState<'INDICATOR' | 'ANALYSIS'>('INDICATOR');
  const [activeRegimeTab, setActiveRegimeTab] = useState<'TREND' | 'RANGE' | 'HIGH_VOLATILITY'>('TREND');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings/signal-sources')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.sources) setSourceConfigs(data.sources);
      })
      .catch((e) => console.warn('Failed to load source settings:', e));
  }, []);

  const saveSourceConfig = async (source: 'INDICATOR' | 'ANALYSIS') => {
    if (!sourceConfigs) return;
    const current = sourceConfigs[source];
    const payload: SourceConfig = {
      ...current,
      minScore: Math.max(60, Math.min(100, Number.isFinite(current.minScore) ? current.minScore : 60)),
      minGrade: current.minGrade === 'A+' || current.minGrade === 'A' ? current.minGrade : 'B',
      cooldownSeconds: Math.max(0, Number.isFinite(current.cooldownSeconds) ? current.cooldownSeconds : 0),
      minimumTechnicalPasses: Math.max(2, Math.min(4, Number.isFinite(current.minimumTechnicalPasses) ? Math.round(current.minimumTechnicalPasses) : 2)),
    };
    try {
      const res = await fetch(`/api/settings/signal-sources/${source}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to save source config.');
      setSourceConfigs((previous) => previous ? { ...previous, [source]: data.config } : previous);
      setSourceConfigStatus(`${source} settings saved (${data.config.version}).`);
    } catch (error) {
      setSourceConfigStatus(error instanceof Error ? error.message : 'Failed to save source settings.');
    }
  };

  const handleSaveWeights = async () => {
    if (!sourceConfigs) return;
    try {
      const res = await fetch(`/api/settings/signal-sources/${weightSource}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weights: sourceConfigs[weightSource].weights }),
      });
      const data = await res.json();
      if (data.success) {
        setSourceConfigs((previous) => previous ? { ...previous, [weightSource]: data.config } : previous);
        setSaveStatus(`${weightSource} weights saved (${data.config.version}).`);
        setTimeout(() => setSaveStatus(null), 3000);
      }
    } catch (e: any) {
      setSaveStatus('Error saving weights');
    }
  };

  const handleTestTelegram = async () => {
    setTelegramTestStatus('Sending test ping...');
    try {
      const res = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: 'XAUUSD',
          botToken: telegramToken || undefined,
          chatId: telegramChatId || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTelegramTestStatus('✓ Telegram ping delivered successfully!');
      } else {
        setTelegramTestStatus(data.error || 'Failed to send');
      }
    } catch (e: any) {
      setTelegramTestStatus(e.message || 'Network error');
    }
    setTimeout(() => setTelegramTestStatus(null), 4000);
  };

  const currentRegimeWeights = sourceConfigs ? sourceConfigs[weightSource].weights[activeRegimeTab] : {};

  return (
    <div className="flex-1 bg-[#07090d] p-5 space-y-5 overflow-y-auto select-none font-mono">
      <div className="bg-[#0b0f17] border border-white/[0.06] rounded-xl p-4 shadow-lg flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <SettingsIcon className="w-4 h-4 text-[#F5C451]" />
            SYSTEM PARAMETERS & INTEGRATIONS
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure weighted scoring matrix, DeepSeek AI credentials, Telegram broadcasting, and language.
          </p>
        </div>
      </div>

      <section className="space-y-3">
        <div>
          <h3 className="text-xs font-bold text-slate-200">INDEPENDENT SIGNAL STREAMS</h3>
          <p className="text-[11px] text-slate-500 mt-1">Balanced profile: score 60 / Grade B with 2 technical confirmations. Each signal needs a directional structure or sweep/reclaim plus an active FVG or order block, a valid risk plan, and healthy live data. Analysis still records all 12 review stages.</p>
        </div>
        {sourceConfigStatus && <p className="text-xs text-cyan-300">{sourceConfigStatus}</p>}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {(['INDICATOR', 'ANALYSIS'] as const).map((source) => {
            const config = sourceConfigs?.[source];
            if (!config) return <div key={source} className="h-40 animate-pulse rounded-md bg-white/[0.03]" />;
            return (
              <div key={source} className="bg-[#0b0f17] border border-white/[0.08] rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className={`text-xs font-bold ${source === 'INDICATOR' ? 'text-cyan-300' : 'text-amber-300'}`}>{source}</h4>
                    <p className="text-[10px] text-slate-500 mt-1">Config {config.version}</p>
                  </div>
                  <label className="flex min-h-11 items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={config.enabled}
                      onChange={(event) => setSourceConfigs((previous) => previous ? {
                        ...previous,
                        [source]: { ...previous[source], enabled: event.target.checked },
                      } : previous)}
                      className="h-5 w-5 accent-[#F5C451]"
                    />
                    Enabled
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <label className="space-y-1 text-slate-400">Minimum score
                    <input type="number" min="60" max="100" value={config.minScore} onChange={(event) => setSourceConfigs((previous) => previous ? {
                      ...previous,
                      [source]: { ...previous[source], minScore: Math.max(60, Math.min(100, Number(event.target.value) || 60)) },
                    } : previous)} className="block h-11 w-full rounded border border-white/10 bg-black/30 px-3 text-slate-100" />
                  </label>
                  <label className="space-y-1 text-slate-400">Minimum grade
                    <select value={config.minGrade} onChange={(event) => setSourceConfigs((previous) => previous ? {
                      ...previous,
                      [source]: { ...previous[source], minGrade: event.target.value as SourceConfig['minGrade'] },
                    } : previous)} className="block h-11 w-full rounded border border-white/10 bg-[#10151d] px-3 text-slate-100">
                      {(['B', 'A', 'A+'] as const).map((grade) => <option key={grade}>{grade}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1 text-slate-400">Cooldown (seconds)
                    <input type="number" min="0" value={config.cooldownSeconds} onChange={(event) => setSourceConfigs((previous) => previous ? {
                      ...previous,
                      [source]: { ...previous[source], cooldownSeconds: Number(event.target.value) },
                    } : previous)} className="block h-11 w-full rounded border border-white/10 bg-black/30 px-3 text-slate-100" />
                  </label>
                  <label className="space-y-1 text-slate-400">Technical confirmations
                    <input type="number" min="2" max="4" value={config.minimumTechnicalPasses} onChange={(event) => setSourceConfigs((previous) => previous ? {
                      ...previous,
                      [source]: { ...previous[source], minimumTechnicalPasses: Math.max(2, Math.min(4, Number(event.target.value) || 2)) },
                    } : previous)} className="block h-11 w-full rounded border border-white/10 bg-black/30 px-3 text-slate-100" />
                  </label>
                </div>
                <button onClick={() => saveSourceConfig(source)} className="min-h-11 rounded border border-white/10 bg-white/[0.04] px-4 text-xs font-semibold text-slate-200 hover:bg-white/[0.08]">
                  Save {source} settings
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left: Dynamic Regime Weights Editor */}
        <div className="bg-[#0b0f17] border border-white/[0.06] rounded-xl p-4 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
            <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <Sliders className="w-4 h-4 text-[#F5C451]" />
              FACTOR WEIGHTS BY REGIME
            </span>

            <button
              onClick={handleSaveWeights}
              className="flex items-center gap-1 px-3 py-1.5 rounded bg-[#F5C451] hover:bg-[#e0b03e] text-black font-bold text-xs shadow-sm transition-all"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save {weightSource} Weights</span>
            </button>
          </div>

          <div className="flex gap-1 rounded-lg border border-white/[0.06] bg-black/30 p-1 text-xs">
            {(['INDICATOR', 'ANALYSIS'] as const).map((source) => (
              <button
                key={source}
                onClick={() => setWeightSource(source)}
                className={`min-h-11 flex-1 rounded px-3 font-semibold ${weightSource === source ? 'bg-white/10 text-slate-100' : 'text-slate-500'}`}
              >
                {source} weights
              </button>
            ))}
          </div>

          {saveStatus && (
            <div className="p-2 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs">
              {saveStatus}
            </div>
          )}

          {/* Regime Tabs */}
          <div className="flex gap-1.5 bg-black/40 p-1 rounded-lg border border-white/[0.04]">
            {(['TREND', 'RANGE', 'HIGH_VOLATILITY'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setActiveRegimeTab(r)}
                className={`flex-1 py-1.5 rounded text-xs transition-all ${
                  activeRegimeTab === r
                    ? 'bg-[#F5C451]/20 text-[#F5C451] font-bold border border-[#F5C451]/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Weights sliders/inputs */}
          <div className="space-y-2.5 text-xs max-h-[380px] overflow-y-auto pr-1">
            {sourceConfigs &&
              Object.keys(currentRegimeWeights).map((code) => (
                <div key={code} className="flex items-center justify-between p-2 rounded bg-white/[0.02] border border-white/[0.04]">
                  <div>
                    <span className="font-bold text-slate-100">{code} Factor</span>
                    <span className="text-[10px] text-slate-500 block">
                      {code === 'S'
                        ? 'Structure (BOS/CHoCH)'
                        : code === 'H'
                        ? 'HTF Bias (H1)'
                        : code === 'F'
                        ? 'Fair Value Gap'
                        : code === 'K'
                        ? 'Key Level / Sweep'
                        : code === 'O'
                        ? 'Order Block'
                        : code === 'T'
                        ? 'Timing & Killzone'
                        : code === 'REG'
                        ? 'Market Regime'
                        : code === 'VWAP'
                        ? 'VWAP Level'
                        : code === 'MOM'
                        ? 'Momentum (RSI/MACD)'
                        : code === 'RAIL'
                        ? 'Session Rails'
                        : `${code} Factor`}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="0"
                      max="30"
                      value={currentRegimeWeights[code] || 0}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setSourceConfigs((previous) => previous ? {
                          ...previous,
                          [weightSource]: {
                            ...previous[weightSource],
                            weights: {
                              ...previous[weightSource].weights,
                              [activeRegimeTab]: {
                                ...previous[weightSource].weights[activeRegimeTab],
                                [code]: val,
                              },
                            },
                          },
                        } : previous);
                      }}
                      className="w-24 accent-[#F5C451]"
                    />
                    <span className="w-8 text-right font-bold text-[#F5C451]">
                      {currentRegimeWeights[code]}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* Right: AI & Telegram Settings */}
        <div className="space-y-4">
          {/* AI Settings Card */}
          <div className="bg-[#0b0f17] border border-white/[0.06] rounded-xl p-4 shadow-lg space-y-3">
            <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5 border-b border-white/[0.06] pb-2">
              <Bot className="w-4 h-4 text-cyan-400" />
              DEEPSEEK & AI ENGINE CONFIG
            </span>

            <div className="space-y-2.5 text-xs">
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">DeepSeek API Key (Optional)</label>
                <div className="relative">
                  <input
                    type="password"
                    placeholder="sk-..."
                    value={deepseekKey}
                    onChange={(e) => setDeepseekKey(e.target.value)}
                    className="w-full bg-black/40 border border-white/[0.08] rounded px-3 py-1.5 text-slate-100 outline-none text-xs"
                  />
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  *If left blank, the applet automatically utilizes Gemini Flash AI for immediate review.
                </span>
              </div>

              <div>
                <label className="text-[11px] text-slate-400 block mb-1">AI Reasoning Model</label>
                <select
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  className="w-full bg-black/40 border border-white/[0.08] rounded px-3 py-1.5 text-slate-200 outline-none text-xs"
                >
                  <option value="deepseek-chat">deepseek-chat (Fast Analysis)</option>
                  <option value="deepseek-reasoner">deepseek-reasoner (Deep Reasoning R1)</option>
                  <option value="gemini-flash">Gemini 3.8 Flash (Default Cloud)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Telegram Settings Card */}
          <div className="bg-[#0b0f17] border border-white/[0.06] rounded-xl p-4 shadow-lg space-y-3">
            <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5 border-b border-white/[0.06] pb-2">
              <Send className="w-4 h-4 text-blue-400" />
              TELEGRAM ALERT BOT
            </span>

            <div className="space-y-2.5 text-xs">
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Bot Token</label>
                <input
                  type="password"
                  placeholder="123456789:ABCdef..."
                  value={telegramToken}
                  onChange={(e) => setTelegramToken(e.target.value)}
                  className="w-full bg-black/40 border border-white/[0.08] rounded px-3 py-1.5 text-slate-100 outline-none text-xs"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-400 block mb-1">Chat ID</label>
                <input
                  type="text"
                  placeholder="@my_channel or -100123456"
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                  className="w-full bg-black/40 border border-white/[0.08] rounded px-3 py-1.5 text-slate-100 outline-none text-xs"
                />
              </div>

              <button
                onClick={handleTestTelegram}
                className="w-full py-2 rounded bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 font-bold text-xs transition-all flex items-center justify-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send Test Alert to Telegram</span>
              </button>

              {telegramTestStatus && (
                <div className="p-2 rounded bg-white/[0.04] text-xs text-center text-slate-300">
                  {telegramTestStatus}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
