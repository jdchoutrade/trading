import React from 'react';
import { useTerminal } from '../context/TerminalContext.tsx';
import { Lock, Shield, Zap } from 'lucide-react';

export const StatusStrip: React.FC = () => {
  const { snapshot, currentPrice, t } = useTerminal();

  if (!snapshot) {
    return (
      <div className="h-7 bg-[#0b0e14] border-b border-white/[0.05] px-4 flex items-center text-xs font-mono text-slate-400">
        <span>Loading quantitative state...</span>
      </div>
    );
  }

  const isBuyLeaning = snapshot.buyScore > snapshot.sellScore;
  const leadVerdict =
    snapshot.verdict !== 'WAIT'
      ? snapshot.verdict
      : isBuyLeaning
      ? 'BUY leads'
      : 'SELL leads';

  const leadScore = Math.max(snapshot.buyScore, snapshot.sellScore);
  const activeFactors = isBuyLeaning ? snapshot.buyFactors : snapshot.sellFactors;
  const passCount = activeFactors.filter((f) => f.status === 'pass').length;
  const totalFactors = activeFactors.length;

  const gradeColor =
    snapshot.grade === 'A+'
      ? 'text-[#F5C451] bg-[#F5C451]/10 border-[#F5C451]/30 font-bold'
      : snapshot.grade === 'A'
      ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30 font-bold'
      : snapshot.grade === 'B'
      ? 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30'
      : snapshot.grade === 'C'
      ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
      : 'text-slate-400 bg-white/[0.02] border-white/[0.06]';

  return (
    <div className="h-7 bg-[#090c12] border-b border-white/[0.05] px-4 flex items-center justify-between text-[11px] font-mono select-none overflow-x-auto whitespace-nowrap">
      <div className="flex items-center gap-3">
        {/* Main Verdict Badge */}
        <div className="flex items-center gap-1.5">
          <span
            className={`font-semibold px-2 py-0.5 rounded text-[10px] uppercase tracking-wider ${
              snapshot.verdict === 'BUY'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : snapshot.verdict === 'SELL'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                : 'bg-white/[0.04] text-slate-300 border border-white/[0.08]'
            }`}
          >
            {snapshot.verdict}
          </span>
          <span className="text-slate-400">·</span>
          <span className={isBuyLeaning ? 'text-emerald-400 font-medium' : 'text-rose-400 font-medium'}>
            {leadVerdict}
          </span>
        </div>

        <span className="text-slate-600">|</span>

        {/* Grade & Score */}
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400">Grade</span>
          <span className={`px-1.5 py-0.2 rounded border text-[10px] ${gradeColor}`}>
            {snapshot.grade}
          </span>
          <span className="text-slate-300 font-semibold">{leadScore}/100</span>
        </div>

        <span className="text-slate-600">|</span>

        {/* Factors Pass Ratio */}
        <div className="flex items-center gap-1 text-slate-300">
          <span className="text-slate-400">Factors:</span>
          <span className="font-semibold text-cyan-400">{passCount}</span>
          <span className="text-slate-400">/{totalFactors}</span>
        </div>

        <span className="text-slate-600">|</span>

        {/* Regime */}
        <div className="flex items-center gap-1.5 text-slate-400">
          <span>Regime:</span>
          <span className="text-slate-200 font-medium">{snapshot.regime.type}</span>
          <span className="text-slate-400">(ADX {snapshot.regime.adx.toFixed(1)})</span>
        </div>

        <span className="text-slate-600">|</span>

        {/* HTF Bias */}
        <div className="flex items-center gap-1.5 text-slate-400">
          <span>H1:</span>
          <span
            className={
              snapshot.mtfBias.h1Bias === 'BULL'
                ? 'text-emerald-400'
                : snapshot.mtfBias.h1Bias === 'BEAR'
                ? 'text-rose-400'
                : 'text-slate-300'
            }
          >
            {snapshot.mtfBias.h1Bias}
          </span>
          <span>·</span>
          <span>M15:</span>
          <span
            className={
              snapshot.mtfBias.m15Structure === 'BULL'
                ? 'text-emerald-400'
                : snapshot.mtfBias.m15Structure === 'BEAR'
                ? 'text-rose-400'
                : 'text-slate-300'
            }
          >
            {snapshot.mtfBias.m15Structure}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Signal Lock status */}
        {snapshot.signalLock.isLocked && (
          <div className="flex items-center gap-1 text-[#F5C451] bg-[#F5C451]/10 px-2 py-0.5 rounded border border-[#F5C451]/30">
            <Lock className="w-3 h-3" />
            <span>LOCKED {snapshot.signalLock.remainingMinutes}m</span>
          </div>
        )}

        {/* ATR */}
        <div className="flex items-center gap-1 text-slate-400">
          <span>ATR(14):</span>
          <span className="text-slate-200 font-semibold">{snapshot.atr14.toFixed(2)}</span>
        </div>

        {/* Local Phnom Penh Time */}
        <div className="flex items-center gap-1 text-slate-400">
          <span>{snapshot.session.localTimeKm}</span>
        </div>
      </div>
    </div>
  );
};

export const SignalSourceStrip: React.FC = () => {
  const { indicatorSnapshot, analysisSnapshot, latestSourceSignals } = useTerminal();
  const directionOf = (verdict?: string) => verdict?.startsWith('BUY') ? 'BUY' : verdict?.startsWith('SELL') ? 'SELL' : undefined;
  const indicatorDirection = directionOf(indicatorSnapshot?.verdict);
  const analysisDirection = directionOf(analysisSnapshot?.verdict);
  const previewAgreement = indicatorDirection && analysisDirection
    ? indicatorDirection === analysisDirection ? 'BOTH_SAME_DIR' : 'OPPOSITE_DIR'
    : undefined;
  const lanes = [
    { source: 'INDICATOR' as const, label: 'INDICATOR', preview: indicatorSnapshot, accent: 'text-cyan-300 border-cyan-500/30' },
    { source: 'ANALYSIS' as const, label: 'ANALYSIS', preview: analysisSnapshot, accent: 'text-amber-300 border-amber-500/30' },
  ];

  return (
    <div className="min-h-10 bg-[#080b11] border-b border-white/[0.06] px-3 py-1 flex gap-2 overflow-x-auto">
      {lanes.map(({ source, label, preview, accent }) => {
        const official = latestSourceSignals[source];
        const previewDirection = directionOf(preview?.verdict);
        const previewScore = previewDirection === 'BUY' ? preview?.buyScore : previewDirection === 'SELL' ? preview?.sellScore : Math.max(preview?.buyScore || 0, preview?.sellScore || 0);
        const passedStages = preview?.analysisStages?.filter((stage) => stage.status === 'PASS').length || 0;
        const directionFactors = previewDirection === 'BUY' ? preview?.buyFactors : previewDirection === 'SELL' ? preview?.sellFactors : [];
        const analysisStages = preview?.analysisStages || [];
        const directionScore = previewDirection === 'BUY' ? preview?.buyScore : previewDirection === 'SELL' ? preview?.sellScore : 0;
        const gradeQualified = preview?.grade === 'B' || preview?.grade === 'A' || preview?.grade === 'A+';
        const technicalPasses = directionFactors?.filter((factor) => ['S', 'F', 'K', 'O'].includes(factor.code) && factor.status === 'pass').length || 0;
        const passedCodes = new Set(directionFactors?.filter((factor) => factor.status === 'pass').map((factor) => factor.code) || []);
        const hasDirectionalSmcSetup = (passedCodes.has('S') || passedCodes.has('K')) && (passedCodes.has('F') || passedCodes.has('O'));
        const analysisDirectionIsFinal = preview?.verdict === 'BUY' || preview?.verdict === 'SELL';
        const analysisGateReady = analysisStages.length === 12
          && analysisStages.find((stage) => stage.index === 1)?.status !== 'FAIL'
          && analysisStages.find((stage) => stage.index === 11)?.status === 'PASS'
          && analysisStages.find((stage) => stage.index === 12)?.status !== 'WAIT'
          && hasDirectionalSmcSetup;
        const liveCandidate = Boolean(
          analysisDirectionIsFinal
          && (directionScore || 0) >= 60
          && gradeQualified
          && technicalPasses >= 2
          && (previewDirection === 'BUY' ? (preview?.buyScore || 0) - (preview?.sellScore || 0) : (preview?.sellScore || 0) - (preview?.buyScore || 0)) >= 5
          && hasDirectionalSmcSetup
          && preview?.signalLock.isLocked
          && preview.tradePlan?.riskRewardValid
          && !preview.isStale
          && !preview.isPriceDivergent
          && !preview.hardBlockReason
          && analysisStages.find((stage) => stage.index === 12)?.status !== 'WAIT'
          && (source !== 'ANALYSIS' || analysisGateReady)
        );
        const current = preview
          ? `${preview.verdict} · ENGINE SCORE ${previewScore}/100`
          : official ? `${official.direction} · ${official.grade} · SCORE ${official.score}/100` : 'WAIT';
        const status = liveCandidate
          ? 'LIVE CANDIDATE · FORMING BAR'
          : preview
            ? source === 'ANALYSIS' ? `LIVE SCAN · ${passedStages}/12 STAGES PASS` : 'LIVE SCAN · AWAITING CONFIRMATION'
            : 'WAIT';
        const officialText = official && preview ? `LAST OFFICIAL ${official.direction} · ${official.score}/100` : '';
        const reason = preview?.hardBlockReason || (source === 'ANALYSIS' && official?.aiState === 'RULE_FUSION_ONLY' ? 'AI SECOND OPINION IS SEPARATE · RULE ENGINE SIGNAL' : '');

        return (
          <div key={source} className={`min-w-0 flex-1 flex items-center gap-2 border-l-2 px-2 text-[10px] font-mono ${accent}`}>
            <strong className="shrink-0">{label}</strong>
            <span className="text-slate-200">{current}</span>
            <span className="text-slate-400">{status}</span>
            {officialText && <span className="text-emerald-300">{officialText}</span>}
            {(official?.agreement || previewAgreement) && <span className={official ? 'text-emerald-300' : 'text-slate-500'}>{official?.agreement || `PREVIEW · ${previewAgreement}`}</span>}
            {reason && <span className="truncate text-slate-500">{reason}</span>}
          </div>
        );
      })}
    </div>
  );
};
