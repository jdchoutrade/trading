import { describe, it, expect } from 'vitest';
import { extractJson, DeepSeekReviewSchema } from '../server/ai/deepseek.ts';

describe('extractJson and DeepSeekReviewSchema', () => {
  it('parses clean JSON', () => {
    const jsonStr = JSON.stringify({
      verdict: 'BUY',
      agreement: 85,
      reasons: ['Strong bullish momentum'],
      risks: ['High spread volatility'],
      invalidation: 2650.5,
      comment_km: 'ការវិភាគល្អ',
      comment_en: 'Good analysis',
    });
    const parsed = extractJson(jsonStr);
    expect(parsed.verdict).toBe('BUY');
    const validated = DeepSeekReviewSchema.parse(parsed);
    expect(validated.verdict).toBe('BUY');
    expect(validated.agreement).toBe(85);
  });

  it('handles markdown code block fences', () => {
    const raw = "```json\n{\n  \"verdict\": \"SELL\",\n  \"agreement\": 90,\n  \"reasons\": [\"R1\"],\n  \"risks\": [\"K1\"],\n  \"invalidation\": 2700,\n  \"comment_km\": \"សាកល្បង\",\n  \"comment_en\": \"Test\"\n}\n```";
    const parsed = extractJson(raw);
    expect(parsed.verdict).toBe('SELL');
  });

  it('handles trailing non-whitespace character after JSON (reproducing the exact bug)', () => {
    // Simulating LLM returning JSON followed by commentary or additional curly braces
    const raw = `
{
  "verdict": "BUY",
  "agreement": 88,
  "reasons": ["Confluence of order blocks"],
  "risks": ["FOMC announcement"],
  "invalidation": 2640.0,
  "comment_km": "ការវិភាគ",
  "comment_en": "Analysis"
}
Here is some additional notes from the LLM model: Note that {X} and {Y} were checked.`;

    const parsed = extractJson(raw);
    expect(parsed.verdict).toBe('BUY');
    expect(parsed.agreement).toBe(88);
    const validated = DeepSeekReviewSchema.parse(parsed);
    expect(validated.invalidation).toBe(2640);
  });

  it('handles trailing commas before closing braces', () => {
    const raw = `{
      "verdict": "WAIT",
      "agreement": 50,
      "reasons": ["Unclear bias",],
      "risks": ["Sideways chop",],
      "invalidation": 0,
      "comment_km": "រង់ចាំ",
      "comment_en": "Wait",
    }`;
    const parsed = extractJson(raw);
    expect(parsed.verdict).toBe('WAIT');
  });
});
