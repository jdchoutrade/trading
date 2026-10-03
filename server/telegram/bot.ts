import { FullAnalysisResult, SignalEntity, SignalEvent } from '../types.ts';

export function formatSourceSignalGroupHtml(signals: SignalEntity[]): string {
  if (signals.length === 0) return '';
  const agreement = signals[0].agreement;
  const agreementLabel = agreement === 'BOTH_SAME_DIR'
    ? 'CONFLUENCE · BOTH SAME DIRECTION'
    : agreement === 'OPPOSITE_DIR'
      ? 'WARNING · SOURCES DISAGREE'
      : 'SOLO SOURCE';
  const signalLines = signals.map((signal) => {
    const badge = signal.source === 'INDICATOR' ? '🔷 [INDICATOR]' : '🧠 [ANALYSIS]';
    return `${badge} <b>${signal.direction} · ${signal.grade} (${signal.score}/100)</b>\nEntry <code>${signal.entryPrice.toFixed(2)}</code> · SL <code>${signal.sl.toFixed(2)}</code> · TP1/2/3 <code>${signal.tp1.toFixed(2)} / ${signal.tp2.toFixed(2)} / ${signal.tp3.toFixed(2)}</code>${signal.aiState === 'RULE_FUSION_ONLY' ? '\nAI review is separate · technical rule signal' : ''}`;
  });
  return `📊 <b>XAUUSD ${signals[0].triggerTf} OFFICIAL SIGNAL GROUP</b>\n${agreementLabel}\n${signalLines.join('\n\n')}\nGroup <code>${signals[0].groupId || 'SOLO'}</code>`;
}

export async function sendTelegramHtmlMessage(
  textHtml: string,
  token?: string,
  chatId?: string
): Promise<{ success: boolean; error?: string }> {
  const botToken = token || process.env.TELEGRAM_BOT_TOKEN;
  const targetChatId = chatId || process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !targetChatId) {
    return {
      success: false,
      error: 'Telegram Bot Token or Chat ID is not configured.',
    };
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: textHtml,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      return { success: false, error: data.description || 'Failed to send Telegram message' };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Telegram network exception' };
  }
}

export function formatSignalHtml(analysis: FullAnalysisResult): string {
  const plan = analysis.tradePlan;
  if (!plan) return '';

  const isBuy = analysis.verdict === 'BUY' || analysis.verdict === 'BUY_LEANS';
  const icon = isBuy ? '🟢' : '🔴';
  const dirName = isBuy ? 'BUY' : 'SELL';
  const gradeIcon = analysis.grade === 'A+' ? '⭐ A+' : analysis.grade;

  const topFactors = (isBuy ? analysis.buyFactors : analysis.sellFactors)
    .filter((f) => f.status === 'pass')
    .slice(0, 3)
    .map((f) => `• <b>${f.name}</b>: ${f.reason}`)
    .join('\n');

  return `
${icon} <b>QRA GOLD TERMINAL · ${dirName} SETUP</b>
━━━━━━━━━━━━━━━━━━
<b>Symbol:</b> <code>${analysis.symbol}</code> (${analysis.timeframe})
<b>Verdict:</b> <b>${analysis.verdict}</b> | Grade: <b>${gradeIcon}</b> (Score: ${isBuy ? analysis.buyScore : analysis.sellScore}/100)
<b>Current Price:</b> <code>${analysis.currentPrice.toFixed(2)}</code> (Spread: $${analysis.spread})

🎯 <b>EXECUTION PLAN</b>
• <b>Entry:</b> <code>${plan.entryPrice.toFixed(2)}</code> (${plan.entryType})
• <b>Stop Loss:</b> <code>${plan.stopLoss.toFixed(2)}</code> (${plan.slAtrMultiple}× ATR)
• <b>TP 1:</b> <code>${plan.tp1.toFixed(2)}</code> (RR ${plan.rr1}R)
• <b>TP 2:</b> <code>${plan.tp2.toFixed(2)}</code> (RR ${plan.rr2}R)
• <b>TP 3:</b> <code>${plan.tp3.toFixed(2)}</code> (RR ${plan.rr3}R)
• <b>Rec. Lot:</b> <code>${plan.suggestedLotSize}</code> (Risk 1.0%)

🏛️ <b>MARKET CONTEXT</b>
• <b>Session:</b> ${analysis.session.currentSession} ${analysis.session.isKillZone ? '⚡ <i>Kill Zone</i>' : ''}
• <b>Regime:</b> ${analysis.regime.type} (ADX: ${analysis.regime.adx.toFixed(1)})
• <b>H1 Bias:</b> ${analysis.mtfBias.h1Bias} | <b>M15:</b> ${analysis.mtfBias.m15Structure}
• <b>Lock Expiry:</b> ${analysis.signalLock.remainingMinutes} min

🧩 <b>TOP CONFIRMATIONS</b>
${topFactors || '• Pure SMC liquidity alignment'}

${analysis.deepSeekReview ? `🤖 <b>AI REVIEW:</b> Agreement <b>${analysis.deepSeekReview.agreement}%</b>\n<i>"${analysis.deepSeekReview.comment_km || analysis.deepSeekReview.comment_en}"</i>` : ''}
━━━━━━━━━━━━━━━━━━
⚠️ <i>Signals are quantitative analysis aids. Maintain strict risk management.</i>
`;
}

// Structured notification formatting for live lifecycle transitions
export function formatOutcomeAlertHtml(
  signal: SignalEntity,
  event: SignalEvent,
  rFinal?: number
): string | null {
  const isBuy = signal.direction === 'BUY';
  const sourceBadge = signal.source === 'INDICATOR' ? '🔷 [INDICATOR]' : signal.source === 'ANALYSIS' ? '🧠 [ANALYSIS]' : '⚪ [UNKNOWN LEGACY]';
  const dirIcon = `${sourceBadge} ${isBuy ? '🟢 BUY' : '🔴 SELL'}`;
  const elapsedMinutes = Math.max(1, Math.round((event.tsUtc - signal.createdTs) / 60));

  switch (event.type) {
    case 'TRIGGERED':
      return `
🚀 <b>SIGNAL TRIGGERED · ${dirIcon}</b>
━━━━━━━━━━━━━━━━━━
<b>Symbol:</b> <code>${signal.symbol}</code> (${signal.triggerTf})
<b>Fill Price:</b> <code>${event.price.toFixed(2)}</code> (Spread: $${event.spread.toFixed(2)})
<b>Initial SL:</b> <code>${signal.sl.toFixed(2)}</code> | <b>Target TP1:</b> <code>${signal.tp1.toFixed(2)}</code>
<b>Time:</b> ${elapsedMinutes}m from signal creation
<b>Agreement:</b> <i>${signal.agreement}</i> · <b>Event feed:</b> <i>${event.source}</i>
━━━━━━━━━━━━━━━━━━
<i>Position active. Automatic spread-aware outcome tracking in progress.</i>
`;

    case 'TP1_HIT':
      return `
🎯 <b>TAKE PROFIT 1 HIT (TP1) · ${dirIcon}</b>
━━━━━━━━━━━━━━━━━━
<b>Symbol:</b> <code>${signal.symbol}</code>
<b>Hit Price:</b> <code>${event.price.toFixed(2)}</code>
<b>Planned RR:</b> <b>+${signal.rrPlanned}R</b>
<b>Elapsed Time:</b> ${elapsedMinutes} minutes
🛡️ <b>MANAGEMENT ACTION:</b>
• Partial profit secured (50%)
• <b>Stop Loss automatically moved to Break-Even (BE)!</b>
━━━━━━━━━━━━━━━━━━
<i>Risk-free trade active toward TP2 (${signal.tp2.toFixed(2)}).</i>
`;

    case 'TP2_HIT':
      return `
🎯🎯 <b>TAKE PROFIT 2 HIT (TP2) · ${dirIcon}</b>
━━━━━━━━━━━━━━━━━━
<b>Symbol:</b> <code>${signal.symbol}</code>
<b>Hit Price:</b> <code>${event.price.toFixed(2)}</code>
<b>Elapsed Time:</b> ${elapsedMinutes} minutes
🛡️ <b>MANAGEMENT ACTION:</b>
• Additional 30% secured (Total 80% closed)
• Runner moving toward TP3 (${signal.tp3.toFixed(2)})
━━━━━━━━━━━━━━━━━━
`;

    case 'TP3_HIT':
      return `
🏆 <b>MAXIMUM TARGET ACHIEVED (TP3) · ${dirIcon}</b>
━━━━━━━━━━━━━━━━━━
<b>Symbol:</b> <code>${signal.symbol}</code>
<b>Final Exit Price:</b> <code>${event.price.toFixed(2)}</code>
<b>Realized Total R:</b> <b>+${rFinal || signal.rrPlanned * 1.5}R</b>
<b>Total Duration:</b> ${elapsedMinutes} minutes
━━━━━━━━━━━━━━━━━━
✨ <i>Trade closed with full quantitative target completion.</i>
`;

    case 'SL_HIT':
      const rDisplay = rFinal !== undefined ? `${rFinal.toFixed(2)}R` : '-1.00R';
      return `
🛑 <b>STOP LOSS HIT · ${dirIcon}</b>
━━━━━━━━━━━━━━━━━━
<b>Symbol:</b> <code>${signal.symbol}</code>
<b>Exit Price:</b> <code>${event.price.toFixed(2)}</code>
<b>Realized Outcome:</b> <b>${rDisplay}</b>
<b>Duration:</b> ${elapsedMinutes} minutes
<b>Invalidation Note:</b> ${event.note || 'Structural level breached'}
━━━━━━━━━━━━━━━━━━
⚠️ <i>Disciplined capital preservation executed. Moving to next high-confluence window.</i>
`;

    case 'BE_EXIT':
      return `
⚪ <b>BREAK-EVEN EXIT · ${dirIcon}</b>
━━━━━━━━━━━━━━━━━━
<b>Symbol:</b> <code>${signal.symbol}</code>
<b>Exit Price:</b> <code>${event.price.toFixed(2)}</code>
<b>Net Realized R:</b> <b>+${rFinal || 0.5}R</b> (Partial TP1 secured)
<b>Duration:</b> ${elapsedMinutes} minutes
━━━━━━━━━━━━━━━━━━
🛡️ <i>Capital protected with zero net loss after initial target.</i>
`;

    case 'TIME_STOP':
      return `
⏱ <b>TIME-STOP EXITED · ${dirIcon}</b>
━━━━━━━━━━━━━━━━━━
<b>Symbol:</b> <code>${signal.symbol}</code>
<b>Exit Price:</b> <code>${event.price.toFixed(2)}</code>
<b>Reason:</b> Maximum holding window elapsed without breakout.
━━━━━━━━━━━━━━━━━━
`;

    case 'INVALIDATED':
      return `
❌ <b>SIGNAL INVALIDATED · ${dirIcon}</b>
━━━━━━━━━━━━━━━━━━
<b>Symbol:</b> <code>${signal.symbol}</code>
<b>Reason:</b> ${event.note || 'Structural shift in opposing direction'}
━━━━━━━━━━━━━━━━━━
`;

    default:
      return null;
  }
}
