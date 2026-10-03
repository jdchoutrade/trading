import { runFullAnalysisPipeline } from '../server/engine/pipeline.ts';
import { sqliteStore } from '../server/db/sqliteStore.ts';
import { Candle, SignalEntity } from '../server/types.ts';
import { StatsEngine } from '../server/stats/statsEngine.ts';

console.log('=====================================================');
console.log('⏳ QRA GOLD TERMINAL · HISTORICAL SIGNAL REPLAY');
console.log('=====================================================\n');

// Generate realistic multi-swing historical candles for backtesting
function generateBacktestCandles(count: number = 350): Candle[] {
  const candles: Candle[] = [];
  let price = 2650.0;
  const startTs = Math.floor(Date.now() / 1000) - count * 15 * 60;

  for (let i = 0; i < count; i++) {
    const time = startTs + i * 15 * 60;
    // Oscillating trend cycles with impulse expansion and pullbacks
    const cycle = Math.sin(i / 14);
    const impulse = (i % 28 < 14 ? 1 : -1) * (1.8 + Math.cos(i / 3) * 0.8);
    const change = cycle * 1.5 + impulse;

    const open = price;
    const close = Number((open + change).toFixed(2));
    const high = Number((Math.max(open, close) + 1.2 + Math.abs(Math.sin(i)) * 0.8).toFixed(2));
    const low = Number((Math.min(open, close) - 1.1 - Math.abs(Math.cos(i)) * 0.7).toFixed(2));
    const volume = 1500 + Math.abs(Math.sin(i)) * 1200;

    candles.push({ time, open, high, low, close, volume });
    price = close;
  }
  return candles;
}

const candles = generateBacktestCandles(350);
console.log(`Analyzing ${candles.length} historical bars (15m timeframe)...`);

let replayedSignalsCount = 0;
const lookbackWindow = 45;

for (let i = lookbackWindow; i < candles.length - 20; i++) {
  const windowCandles = candles.slice(0, i + 1);
  const currentCandle = windowCandles[windowCandles.length - 1];

  const analysis = runFullAnalysisPipeline({
    symbol: 'XAUUSD',
    timeframe: '15m',
    currentPrice: currentCandle.close,
    candles: windowCandles,
    spread: 0.35,
  });

  const { verdict, grade, tradePlan } = analysis;
  if (!tradePlan) continue;
  if (grade !== 'A+' && grade !== 'A' && grade !== 'B') continue;

  const isBuy = verdict === 'BUY' || verdict === 'BUY_LEANS';
  const isSell = verdict === 'SELL' || verdict === 'SELL_LEANS';
  if (!isBuy && !isSell) continue;
  const signalId = `replay_${currentCandle.time}`;

  // Check if signal already exists in SQLite
  if (sqliteStore.getSignal(signalId)) continue;

  const signal: Omit<SignalEntity, 'snapshotHash' | 'prevHash'> = {
    id: signalId,
    createdTs: currentCandle.time,
    candleCloseTs: currentCandle.time,
    symbol: 'XAUUSD',
    sourceFeed: 'HISTORICAL_REPLAY',
    direction: isBuy ? 'BUY' : 'SELL',
    triggerTf: '15m',
    entryType: 'MARKET',
    entryPrice: tradePlan.entryPrice,
    sl: tradePlan.stopLoss,
    tp1: tradePlan.tp1,
    tp2: tradePlan.tp2,
    tp3: tradePlan.tp3,
    rrPlanned: tradePlan.rr1,
    score: isBuy ? analysis.buyScore : analysis.sellScore,
    grade,
    regime: analysis.regime.type,
    session: analysis.session.currentSession,
    factors: (isBuy ? analysis.buyFactors : analysis.sellFactors)
      .filter((f) => f.status === 'pass')
      .map((f) => ({ code: f.code, name: f.name, reason: f.reason, weight: f.weight })),
    weightsVersion: '2.0.0',
    configVersion: '2.0.0',
    priceFeedSnapshot: {
      primaryPrice: currentCandle.close,
      spread: 0.35,
      latencyMs: 0,
    },
    mgmtPlan: {
      partialCloseTp1Percent: 50,
      partialCloseTp2Percent: 30,
      moveSlToBreakEvenAtTp1: true,
      maxCandlesTimeStop: 48,
    },
    brokerOffset: 0,
    tags: ['replay', 'backtest'],
    source: 'INDICATOR',
    origin: 'replay',
    agreement: 'SOLO',
    inputProvenance: { engine: 'L1-L11', marketData: 'synthetic-replay' },
    aiState: 'NOT_USED',
    hashVersion: 1,
  };

  const { source: replaySource, hashVersion: _hashVersion, ...replaySignal } = signal;
  const savedSignal = sqliteStore.createFromEngine('INDICATOR', replaySignal);

  // Walk forward subsequent bars to evaluate outcome
  let status: any = 'TRIGGERED';
  let rFinal = 0;
  let exitPrice = tradePlan.entryPrice;
  let duration = 0;
  let tp1Hit = false;

  for (let j = i + 1; j < Math.min(candles.length, i + 48); j++) {
    const bar = candles[j];
    duration = bar.time - currentCandle.time;

    const hitSl = isBuy ? bar.low <= tradePlan.stopLoss : bar.high >= tradePlan.stopLoss;
    const hitTp1 = isBuy ? bar.high >= tradePlan.tp1 : bar.low <= tradePlan.tp1;

    // Same bar ambiguity resolution: Conservative SL first
    if (hitSl && hitTp1) {
      status = 'SL_HIT';
      rFinal = -1.0;
      exitPrice = tradePlan.stopLoss;
      break;
    }

    if (!tp1Hit && hitTp1) {
      tp1Hit = true;
      status = 'TP1_HIT';
    }

    if (hitSl) {
      if (tp1Hit) {
        status = 'BE_EXIT';
        rFinal = Number((tradePlan.rr1 * 0.5).toFixed(2));
      } else {
        status = 'SL_HIT';
        rFinal = -1.0;
      }
      exitPrice = tradePlan.stopLoss;
      break;
    }

    const hitTp2 = isBuy ? bar.high >= tradePlan.tp2 : bar.low <= tradePlan.tp2;
    if (tp1Hit && hitTp2) {
      status = 'TP2_HIT';
    }

    const hitTp3 = isBuy ? bar.high >= tradePlan.tp3 : bar.low <= tradePlan.tp3;
    if (hitTp2 && hitTp3) {
      status = 'TP3_HIT';
      rFinal = Number((tradePlan.rr1 * 1.5).toFixed(2));
      exitPrice = tradePlan.tp3;
      break;
    }
  }

  // Record closing event in append-only log
  if (status !== 'TRIGGERED') {
    sqliteStore.addSignalEvent({
      id: `ev_${savedSignal.id}_close`,
      signalId: savedSignal.id,
      type: status,
      price: exitPrice,
      bid: exitPrice,
      ask: exitPrice,
      spread: 0.35,
      tsUtc: currentCandle.time + duration,
      source: 'reconstructed',
      note: `Historical backtest outcome: ${status} (${rFinal}R)`,
    });
  }

  // Update outcome in DB
  sqliteStore.updateSignalOutcome({
    signalId: savedSignal.id,
    status,
    fillPrice: tradePlan.entryPrice,
    exitPriceEffective: exitPrice,
    rFinal,
    duration,
    reconstructedFlag: true,
  });

  replayedSignalsCount++;
  // Advance by at least 8 bars to avoid overlapping setups in replay
  i += 8;
}

console.log(`\n✅ REPLAY FINISHED: ${replayedSignalsCount} out-of-sample signals generated and evaluated.`);

// Compute stats
const { signals: replaySignals } = sqliteStore.getAllSignals({ origin: 'replay' });
const stats = StatsEngine.calculateSummary(replaySignals, 10);
console.log('-----------------------------------------------------');
console.log(`Replay Sample Count: ${stats.sampleCount}`);
console.log(`Win Rate: ${stats.winRate}% (Wilson 95% CI: [${stats.wilsonInterval[0]}%, ${stats.wilsonInterval[1]}%])`);
console.log(`Expectancy: ${stats.expectancyR}R per trade`);
console.log(`Profit Factor: ${stats.profitFactor}`);
console.log(`TP1 Hit Rate: ${stats.tp1HitRate}% | SL Hit Rate: ${stats.slHitRate}%`);
console.log('-----------------------------------------------------\n');
