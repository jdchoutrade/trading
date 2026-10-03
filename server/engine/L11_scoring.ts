import {
  Candle,
  LiquidityLevel,
  OrderBlock,
  SignalGrade,
  SignalLock,
  SignalVerdict,
  TradePlan,
} from '../types.ts';
import { calculateATR } from './indicators.ts';

export interface ScoringInput {
  buyScore: number;
  sellScore: number;
  currentPrice: number;
  candles: Candle[];
  orderBlocks: OrderBlock[];
  liquidityLevels: LiquidityLevel[];
  isHardBlocked: boolean;
  currentLock?: SignalLock;
  accountSize?: number;
  riskPercent?: number;
}

export interface ScoringOutput {
  verdict: SignalVerdict;
  grade: SignalGrade;
  signalLock: SignalLock;
  tradePlan?: TradePlan;
}

export function computeSignalAndTradePlan(input: ScoringInput): ScoringOutput {
  const {
    buyScore,
    sellScore,
    currentPrice,
    candles,
    orderBlocks,
    liquidityLevels,
    isHardBlocked,
    currentLock,
    accountSize = 10000,
    riskPercent = 1.0,
  } = input;

  const nowSec = Math.floor(Date.now() / 1000);
  const atrs = calculateATR(candles, 14);
  const currentATR = Math.max(0.5, atrs[atrs.length - 1] || 2.0);
  const gradeForScore = (score: number): SignalGrade =>
    score >= 85 ? 'A+' : score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 50 ? 'C' : 'X';

  if (isHardBlocked) {
    return {
      verdict: 'WAIT',
      grade: 'X',
      signalLock: { isLocked: false, lockUntil: 0, remainingMinutes: 0 },
    };
  }

  // Check existing lock
  if (currentLock && currentLock.isLocked && currentLock.lockUntil > nowSec) {
    const isInvalidated =
      currentLock.invalidationLevel &&
      ((currentLock.lockedVerdict === 'BUY' && currentPrice < currentLock.invalidationLevel) ||
        (currentLock.lockedVerdict === 'SELL' && currentPrice > currentLock.invalidationLevel));

    if (!isInvalidated) {
      const remainingMinutes = Math.max(0, Math.round((currentLock.lockUntil - nowSec) / 60));
      const lockedScore = currentLock.lockedVerdict?.startsWith('SELL') ? sellScore : buyScore;
      return {
        verdict: currentLock.lockedVerdict || 'WAIT',
        grade: gradeForScore(lockedScore),
        signalLock: {
          ...currentLock,
          remainingMinutes,
        },
      };
    }
  }

  // Determine top score & direction
  const maxScore = Math.max(buyScore, sellScore);
  const scoreSeparation = Math.abs(buyScore - sellScore);
  const direction: 'BUY' | 'SELL' = buyScore >= sellScore ? 'BUY' : 'SELL';

  const grade = gradeForScore(maxScore);

  let verdict: SignalVerdict = 'WAIT';
  if (maxScore >= 60 && scoreSeparation >= 5) {
    verdict = direction;
  } else if (maxScore >= 55 && scoreSeparation >= 5) {
    verdict = direction === 'BUY' ? 'BUY_LEANS' : 'SELL_LEANS';
  } else {
    verdict = 'WAIT';
  }

  // Calculate a trade plan for a confirmed B-grade-or-better direction.
  let tradePlan: TradePlan | undefined;
  let signalLock: SignalLock = {
    isLocked: false,
    lockUntil: 0,
    remainingMinutes: 0,
  };

  if (verdict === 'BUY' || (verdict === 'BUY_LEANS' && maxScore >= 65)) {
    // BUY SETUP
    const obProximity = Math.max(2, currentATR * 0.35);
    const nearbyOB = orderBlocks
      .filter((ob) => ob.type === 'BULLISH' && !ob.mitigated && currentPrice >= ob.low - obProximity && currentPrice <= ob.high + obProximity)
      .sort((a, b) => Math.abs(currentPrice - a.mid) - Math.abs(currentPrice - b.mid) || b.time - a.time)[0];
    const entryPrice = nearbyOB ? nearbyOB.mid : currentPrice;

    // SL: behind OB low or recent swing low - 0.3 ATR
    const baseSL = nearbyOB ? nearbyOB.low - 0.3 * currentATR : currentPrice - 1.4 * currentATR;
    const slDistance = Math.min(2.5 * currentATR, Math.max(1.2 * currentATR, entryPrice - baseSL));
    const stopLoss = Number((entryPrice - slDistance).toFixed(2));
    const slAtrMultiple = Number((slDistance / currentATR).toFixed(2));

    // Target liquidity pools above price
    const buySideLiquidity = liquidityLevels
      .filter((l) => (l.type === 'SWING_HIGH' || l.type === 'EQUAL_HIGH' || l.type === 'ROUND_NUMBER') && l.price > entryPrice)
      .sort((a, b) => a.price - b.price);

    const tp1 = buySideLiquidity[0] ? buySideLiquidity[0].price : Number((entryPrice + slDistance * 1.5).toFixed(2));
    const tp2 = buySideLiquidity[1] ? buySideLiquidity[1].price : Number((entryPrice + slDistance * 2.6).toFixed(2));
    const tp3 = buySideLiquidity[2] ? buySideLiquidity[2].price : Number((entryPrice + slDistance * 5.0).toFixed(2));

    const rr1 = Number(((tp1 - entryPrice) / slDistance).toFixed(2));
    const rr2 = Number(((tp2 - entryPrice) / slDistance).toFixed(2));
    const rr3 = Number(((tp3 - entryPrice) / slDistance).toFixed(2));

    const riskRewardValid = rr1 >= 1.4;

    // Lot Size calculation: (Account * Risk%) / (SL in points * 100)
    const riskDollar = (accountSize * riskPercent) / 100;
    const lotSize = Number((riskDollar / (slDistance * 100)).toFixed(2));

    tradePlan = {
      entryType: nearbyOB ? 'LIMIT' : 'MARKET',
      entryPrice: Number(entryPrice.toFixed(2)),
      stopLoss,
      slAtrMultiple,
      tp1,
      tp2,
      tp3,
      rr1,
      rr2,
      rr3,
      riskRewardValid,
      suggestedLotSize: Math.max(0.01, lotSize),
      invalidationLevel: stopLoss,
      partialCloseTp1Percent: 50,
      partialCloseTp2Percent: 30,
      moveSlToBreakEvenAtTp1: true,
      trailingStopRule: 'Trail behind structural swing high/low once TP1 reached',
      timeStopMaxCandles: 8,
    };

    if (verdict === 'BUY' && riskRewardValid) {
      signalLock = {
        isLocked: true,
        lockUntil: nowSec + 20 * 60, // 20 minutes
        lockedVerdict: 'BUY',
        invalidationLevel: stopLoss,
        remainingMinutes: 20,
      };
    }
  } else if (verdict === 'SELL' || (verdict === 'SELL_LEANS' && maxScore >= 65)) {
    // SELL SETUP
    const obProximity = Math.max(2, currentATR * 0.35);
    const nearbyOB = orderBlocks
      .filter((ob) => ob.type === 'BEARISH' && !ob.mitigated && currentPrice >= ob.low - obProximity && currentPrice <= ob.high + obProximity)
      .sort((a, b) => Math.abs(currentPrice - a.mid) - Math.abs(currentPrice - b.mid) || b.time - a.time)[0];
    const entryPrice = nearbyOB ? nearbyOB.mid : currentPrice;

    const baseSL = nearbyOB ? nearbyOB.high + 0.3 * currentATR : currentPrice + 1.4 * currentATR;
    const slDistance = Math.min(2.5 * currentATR, Math.max(1.2 * currentATR, baseSL - entryPrice));
    const stopLoss = Number((entryPrice + slDistance).toFixed(2));
    const slAtrMultiple = Number((slDistance / currentATR).toFixed(2));

    const sellSideLiquidity = liquidityLevels
      .filter((l) => (l.type === 'SWING_LOW' || l.type === 'EQUAL_LOW' || l.type === 'ROUND_NUMBER') && l.price < entryPrice)
      .sort((a, b) => b.price - a.price);

    const tp1 = sellSideLiquidity[0] ? sellSideLiquidity[0].price : Number((entryPrice - slDistance * 1.5).toFixed(2));
    const tp2 = sellSideLiquidity[1] ? sellSideLiquidity[1].price : Number((entryPrice - slDistance * 2.6).toFixed(2));
    const tp3 = sellSideLiquidity[2] ? sellSideLiquidity[2].price : Number((entryPrice - slDistance * 5.0).toFixed(2));

    const rr1 = Number(((entryPrice - tp1) / slDistance).toFixed(2));
    const rr2 = Number(((entryPrice - tp2) / slDistance).toFixed(2));
    const rr3 = Number(((entryPrice - tp3) / slDistance).toFixed(2));

    const riskRewardValid = rr1 >= 1.4;

    const riskDollar = (accountSize * riskPercent) / 100;
    const lotSize = Number((riskDollar / (slDistance * 100)).toFixed(2));

    tradePlan = {
      entryType: nearbyOB ? 'LIMIT' : 'MARKET',
      entryPrice: Number(entryPrice.toFixed(2)),
      stopLoss,
      slAtrMultiple,
      tp1,
      tp2,
      tp3,
      rr1,
      rr2,
      rr3,
      riskRewardValid,
      suggestedLotSize: Math.max(0.01, lotSize),
      invalidationLevel: stopLoss,
      partialCloseTp1Percent: 50,
      partialCloseTp2Percent: 30,
      moveSlToBreakEvenAtTp1: true,
      trailingStopRule: 'Trail behind structural swing high/low once TP1 reached',
      timeStopMaxCandles: 8,
    };

    if (verdict === 'SELL' && riskRewardValid) {
      signalLock = {
        isLocked: true,
        lockUntil: nowSec + 20 * 60,
        lockedVerdict: 'SELL',
        invalidationLevel: stopLoss,
        remainingMinutes: 20,
      };
    }
  }

  return {
    verdict,
    grade,
    signalLock,
    tradePlan,
  };
}
