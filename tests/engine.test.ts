import { describe, expect, it } from 'vitest';
import { Candle } from '../server/types.ts';
import {
  calculateADX,
  calculateATR,
  calculateBollingerBands,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateVWAP,
} from '../server/engine/indicators.ts';
import { detectMarketRegime } from '../server/engine/L1_regime.ts';
import { analyzeMultiTimeframe } from '../server/engine/L2_multitimeframe.ts';
import { identifyLiquidityLevels } from '../server/engine/L3_liquidity.ts';
import { detectBOSAndCHoCH, detectFVGs, detectLiquiditySweeps, detectOrderBlocks } from '../server/engine/L4_smc.ts';
import { analyzeSession } from '../server/engine/L9_session.ts';
import { evaluateConfirmations } from '../server/engine/L10_confirmation.ts';
import { computeSignalAndTradePlan } from '../server/engine/L11_scoring.ts';
import { runFullAnalysisPipeline } from '../server/engine/pipeline.ts';

// Candle fixture generator
function generateTestCandles(count: number, startPrice: number = 2650, trend: 'up' | 'down' | 'range' = 'range'): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  const baseTime = 1700000000;

  for (let i = 0; i < count; i++) {
    const time = baseTime + i * 900;
    let change = (Math.random() - 0.49) * 2;
    if (trend === 'up') change += 0.8;
    if (trend === 'down') change -= 0.8;

    const open = price;
    const close = open + change;
    const high = Math.max(open, close) + Math.random() * 1.5;
    const low = Math.min(open, close) - Math.random() * 1.5;
    const volume = 100 + Math.floor(Math.random() * 500);

    candles.push({ time, open, high, low, close, volume });
    price = close;
  }
  return candles;
}

describe('L5-L7 Pure Indicators', () => {
  it('calculates EMA correctly', () => {
    const data = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    const ema = calculateEMA(data, 5);
    expect(ema.length).toBe(10);
    expect(ema[9]).toBeGreaterThan(ema[0]);
  });

  it('calculates ATR correctly', () => {
    const candles = generateTestCandles(30);
    const atr = calculateATR(candles, 14);
    expect(atr.length).toBe(30);
    expect(atr[29]).toBeGreaterThan(0);
  });

  it('calculates Bollinger Bands and detects width', () => {
    const candles = generateTestCandles(40);
    const bb = calculateBollingerBands(candles, 20, 2);
    expect(bb.middle.length).toBe(40);
    expect(bb.upper[39]).toBeGreaterThan(bb.lower[39]);
  });

  it('calculates RSI within 0-100 bounds', () => {
    const candles = generateTestCandles(40, 2650, 'up');
    const rsi = calculateRSI(candles, 14);
    expect(rsi[39]).toBeGreaterThanOrEqual(0);
    expect(rsi[39]).toBeLessThanOrEqual(100);
  });

  it('calculates MACD lines and histogram', () => {
    const candles = generateTestCandles(40);
    const macd = calculateMACD(candles);
    expect(macd.macd.length).toBe(40);
    expect(macd.signal.length).toBe(40);
    expect(macd.histogram.length).toBe(40);
  });

  it('calculates ADX and Directional Indicators', () => {
    const candles = generateTestCandles(50, 2650, 'up');
    const adx = calculateADX(candles, 14);
    expect(adx.adx.length).toBe(50);
  });

  it('calculates VWAP and standard deviation bands', () => {
    const candles = generateTestCandles(30);
    const vwap = calculateVWAP(candles);
    expect(vwap.upperBand[29]).toBeGreaterThan(vwap.lowerBand[29]);
  });
});

describe('L1 Market Regime', () => {
  it('detects regime from candle series', () => {
    const candles = generateTestCandles(60, 2650, 'up');
    const regime = detectMarketRegime(candles);
    expect(['TREND_BULL', 'TREND_BEAR', 'RANGE', 'HIGH_VOLATILITY']).toContain(regime.type);
    expect(regime.confidence).toBeGreaterThan(0);
  });
});

describe('L2 Multi-Timeframe Alignment', () => {
  it('analyzes MTF bias across timeframes', () => {
    const m1 = generateTestCandles(30);
    const m5 = generateTestCandles(30);
    const m15 = generateTestCandles(30);
    const h1 = generateTestCandles(60, 2650, 'up');
    const h4 = generateTestCandles(30);

    const mtf = analyzeMultiTimeframe(m1, m5, m15, h1, h4);
    expect(['BULL', 'BEAR', 'NEUTRAL']).toContain(mtf.h1Bias);
    expect(mtf.alignmentScore).toBeGreaterThanOrEqual(0);
  });
});

describe('L3 Liquidity Map', () => {
  it('identifies swing points and round numbers', () => {
    const candles = generateTestCandles(40);
    const levels = identifyLiquidityLevels(candles, '15m');
    expect(Array.isArray(levels)).toBe(true);
    expect(levels.some((l) => l.type === 'ROUND_NUMBER')).toBe(true);
  });
});

describe('L4 SMC Engine (BOS, CHoCH, OB, FVG, Sweeps)', () => {
  it('detects order blocks with mitigation tracking', () => {
    const candles = generateTestCandles(50);
    const obs = detectOrderBlocks(candles, '15m');
    expect(Array.isArray(obs)).toBe(true);
    if (obs.length > 0) {
      expect(obs[0].strength).toBeGreaterThanOrEqual(4);
    }
  });

  it('detects Fair Value Gaps', () => {
    const candles = generateTestCandles(50);
    const fvgs = detectFVGs(candles, '15m');
    expect(Array.isArray(fvgs)).toBe(true);
  });
});

describe('L9 Session Filter & Rollover Block', () => {
  it('identifies sessions and flags rollover window', () => {
    const candles = generateTestCandles(20);
    // Rollover test timestamp: 22:00 UTC (1700085600)
    const rolloverDate = new Date('2026-03-15T22:15:00Z');
    const session = analyzeSession(candles, Math.floor(rolloverDate.getTime() / 1000));
    expect(session.isRolloverBlocked).toBe(true);
    expect(session.currentSession).toBe('ROLLOVER');
  });
});

describe('L10 & L11 Confirmation & Scoring', () => {
  it('enforces hard block on stale data', () => {
    const candles = generateTestCandles(50);
    const result = runFullAnalysisPipeline({
      symbol: 'XAUUSD',
      timeframe: '15m',
      currentPrice: 2650,
      candles,
      isStale: true,
    });

    expect(result.verdict).toBe('WAIT');
    expect(result.grade).toBe('X');
    expect(result.hardBlockReason).toContain('DATA STALE');
  });

  it('runs complete pipeline cleanly and generates factors', () => {
    const candles = generateTestCandles(60);
    const result = runFullAnalysisPipeline({
      symbol: 'XAUUSD',
      timeframe: '15m',
      currentPrice: 2655,
      candles,
      isStale: false,
    });

    expect(result.buyFactors.length).toBeGreaterThan(5);
    expect(result.sellFactors.length).toBeGreaterThan(5);
    expect(result.buyScore).toBeGreaterThanOrEqual(0);
    expect(result.sellScore).toBeGreaterThanOrEqual(0);
  });
});

describe('AI JSON Extraction & Schema Resilience', () => {
  it('correctly parses JSON even with non-whitespace text after the JSON block (e.g. line 18 col 1)', async () => {
    const { extractJson, DeepSeekReviewSchema } = await import('../server/ai/deepseek.ts');
    
    // Simulate LLM returning extra commentary after the closing brace
    const rawResponse = `\`\`\`json
{
  "verdict": "WAIT",
  "agreement": 82,
  "reasons": ["ADX confirms strong compression", "Unmitigated order block below"],
  "risks": ["Spread expansion during killzone transition"],
  "invalidation": 2642.50,
  "comment_km": "ទីផ្សារស្ថិតក្នុងសភាព Range សូមរង់ចាំការទម្លុះ",
  "comment_en": "Market remains in compression, wait for directional expansion"
}
\`\`\`
Note: This setup is based strictly on M15 SMC rules. Risk management is advised.`;

    const parsed = extractJson(rawResponse);
    expect(parsed.verdict).toBe('WAIT');
    expect(parsed.agreement).toBe(82);

    const validated = DeepSeekReviewSchema.parse(parsed);
    expect(validated.verdict).toBe('WAIT');
    expect(validated.reasons.length).toBe(2);
    expect(validated.invalidation).toBe(2642.5);
  });
});
