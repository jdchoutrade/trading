import { afterEach, describe, expect, it } from 'vitest';
import { requestAiReview } from '../server/ai/deepseek.ts';
import { getSignalSourceConfig } from '../server/engine/sourceConfig.ts';
import { FullAnalysisResult } from '../server/types.ts';

const originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;
const originalGeminiKey = process.env.GEMINI_API_KEY;

afterEach(() => {
  if (originalDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalDeepSeekKey;
  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiKey;
});

describe('signal source configuration', () => {
  it('loads independent source versions and scoring matrices', () => {
    const indicator = getSignalSourceConfig('INDICATOR');
    const analysis = getSignalSourceConfig('ANALYSIS');

    expect(indicator.version).not.toBe(analysis.version);
    expect(indicator.weights.TREND.XA).toBe(0);
    expect(analysis.weights.TREND.XA).toBeGreaterThan(0);
    expect(analysis.aiOfflineMode).toBe('RULE_FUSION_ONLY');
  });

  it('returns no AI verdict when automated source generation forbids rule fallback', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const snapshot = { symbol: 'XAUUSD', timeframe: '15m', currentPrice: 2500 } as FullAnalysisResult;

    await expect(requestAiReview(snapshot, undefined, { allowRuleFallback: false, useCache: false })).resolves.toBeNull();
  });
});
