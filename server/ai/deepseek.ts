import { GoogleGenAI, Type } from '@google/genai';
import { z } from 'zod';
import { DeepSeekReview, FullAnalysisResult } from '../types.ts';

// Helper function to extract and parse pure JSON from LLM responses even if there are code fences, comments, or trailing non-whitespace characters
export function extractJson(text: string): any {
  if (!text) throw new Error('Empty text received for JSON parsing');
  let cleaned = text.trim();

  // 1. Direct parse attempt
  try {
    return JSON.parse(cleaned);
  } catch {}

  // 2. Strip markdown code fences if wrapped in ```json ... ``` or ``` ... ```
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {}
    cleaned = fenceMatch[1].trim();
  }

  // 3. Balanced brace parsing to find exact bounds of root JSON object
  const firstBrace = cleaned.indexOf('{');
  if (firstBrace !== -1) {
    let inString = false;
    let escape = false;
    let depth = 0;
    let endIdx = -1;

    for (let i = firstBrace; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === '{') {
          depth++;
        } else if (char === '}') {
          depth--;
          if (depth === 0) {
            endIdx = i;
            break;
          }
        }
      }
    }

    if (endIdx !== -1) {
      const candidate = cleaned.substring(firstBrace, endIdx + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        // Sanitize trailing commas before closing braces/brackets
        const sanitized = candidate.replace(/,\s*([\]}])/g, '$1');
        try {
          return JSON.parse(sanitized);
        } catch {}
      }
    }
  }

  // 4. Substring from first '{' to last '}' with trailing-character truncation fallback
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) {
    const candidate = cleaned.substring(first, last + 1);
    try {
      return JSON.parse(candidate);
    } catch (err: any) {
      const matchPos = err.message?.match(/position\s+(\d+)/);
      if (matchPos) {
        const pos = parseInt(matchPos[1], 10);
        if (pos > 0 && pos <= candidate.length) {
          try {
            return JSON.parse(candidate.slice(0, pos).trim());
          } catch {}
        }
      }
    }
  }

  // 5. Final fallback parse
  return JSON.parse(cleaned);
}

// Strict schema validation for AI Review with automatic coercion and graceful fallbacks
export const DeepSeekReviewSchema = z.object({
  verdict: z.preprocess(
    (v) => (typeof v === 'string' ? v.toUpperCase().trim() : 'WAIT'),
    z.enum(['BUY', 'SELL', 'WAIT']).catch('WAIT')
  ),
  agreement: z.coerce.number().min(0).max(100),
  reasons: z.preprocess(
    (v) => (Array.isArray(v) && v.length > 0 ? v : ['Technical confirmation verified']),
    z.array(z.string()).catch(['Technical confirmation verified'])
  ),
  risks: z.preprocess(
    (v) => (Array.isArray(v) && v.length > 0 ? v : ['Spread volatility and liquidity sweep risk']),
    z.array(z.string()).catch(['Spread volatility and liquidity sweep risk'])
  ),
  invalidation: z.coerce.number().catch(0),
  comment_km: z.string().catch('ការវិភាគបច្ចេកទេស និងកម្រិត Stop Loss ត្រូវអនុវត្តយ៉ាងម៉ឺងម៉ាត់។'),
  comment_en: z.string().catch('Quantitative technical analysis completed. Strictly manage risk.'),
});

interface CacheEntry {
  timestamp: number;
  review: DeepSeekReview;
}

const reviewCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 1000; // 60s cache

export async function requestAiReview(
  snapshot: FullAnalysisResult,
  customApiKey?: string,
  options: { allowRuleFallback?: boolean; useCache?: boolean } = {}
): Promise<DeepSeekReview | null> {
  const cacheKey = `${snapshot.symbol}_${snapshot.timeframe}_${Math.floor(snapshot.currentPrice * 10)}`;
  const cached = reviewCache.get(cacheKey);
  if (options.useCache !== false && cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.review;
  }

  const deepseekKey = customApiKey || process.env.DEEPSEEK_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (options.allowRuleFallback === false && !deepseekKey && !geminiKey) return null;

  const systemPrompt = `You are a Senior Quantitative Trading Systems Architect and Smart Money Concepts (SMC/ICT) specialist reviewing an algorithmic setup for XAUUSD (Gold).
You must analyze the technical snapshot and provide a rigorous second opinion.
CRITICAL RULES:
1. If the engine has a HARD BLOCK or is WAIT due to stale data/rollover/regime mismatch, you MUST NOT force a BUY or SELL.
2. Economic calendar actuals, forecasts, and prior values are context only. Compare releases with consensus, identify uncertainty, and require observed USD/yield/gold price reaction before assigning a directional effect.
3. Return ONLY a valid, raw JSON object matching the exact schema below. Do not wrap in markdown quotes if possible, or only use standard json markdown.
JSON Schema:
{
  "verdict": "BUY" | "SELL" | "WAIT",
  "agreement": <number between 0 and 100 representing your alignment with the algorithmic engine verdict>,
  "reasons": ["<reason 1>", "<reason 2>", "<reason 3>"],
  "risks": ["<key risk 1>", "<key risk 2>"],
  "invalidation": <price level where this setup is invalidated>,
  "comment_km": "<Comprehensive quantitative breakdown in Khmer language (ភាសាខ្មែរ)>",
  "comment_en": "<Comprehensive quantitative breakdown in English>"
}`;

  const promptUser = `CURRENT MARKET SNAPSHOT:
Symbol: ${snapshot.symbol} (${snapshot.timeframe})
Current Price: ${snapshot.currentPrice} (Spread: ${snapshot.spread}, ATR: ${snapshot.atr14})
Engine Verdict: ${snapshot.verdict} (Grade: ${snapshot.grade})
Buy Score: ${snapshot.buyScore}/100 | Sell Score: ${snapshot.sellScore}/100
Market Regime: ${snapshot.regime.type} (ADX: ${snapshot.regime.adx}, Conf: ${snapshot.regime.confidence}%)
Multi-Timeframe Bias: H1: ${snapshot.mtfBias.h1Bias}, H4: ${snapshot.mtfBias.h4Bias}, M15: ${snapshot.mtfBias.m15Structure}
Session: ${snapshot.session.currentSession} (${snapshot.session.isKillZone ? 'KILL ZONE' : 'Normal'})
Hard Block: ${snapshot.hardBlockReason || 'None'}
Trade Plan: Entry: ${snapshot.tradePlan?.entryPrice || 'N/A'}, SL: ${snapshot.tradePlan?.stopLoss || 'N/A'}, TP1: ${snapshot.tradePlan?.tp1 || 'N/A'}, RR: ${snapshot.tradePlan?.rr1 || 'N/A'}
Top Passing Factors:
${snapshot.buyFactors.filter((f) => f.status === 'pass').map((f) => `BUY ${f.code}: ${f.reason}`).join('\n')}
${snapshot.sellFactors.filter((f) => f.status === 'pass').map((f) => `SELL ${f.code}: ${f.reason}`).join('\n')}

12-Stage Checks:
${(snapshot.analysisStages || []).map((stage) => `L${stage.index} ${stage.name}: ${stage.status} — ${stage.evidence}`).join('\n') || 'No structured 12-stage data supplied.'}
Upcoming High-Impact Events:
${(snapshot.scheduledEvents || []).filter((event) => event.impact === 'HIGH').slice(0, 5).map((event) => `${event.country} ${event.title} at ${new Date(event.scheduledAt * 1000).toISOString()} · actual ${event.actual || 'not released'} · forecast ${event.forecast || 'not supplied'} · previous ${event.previous || 'not supplied'} (${event.source})`).join('\n') || 'No loaded high-impact events.'}
Corroborated Recent Headlines:
${(snapshot.recentStories || []).filter((story) => story.verificationStatus === 'MULTI-SOURCE').slice(0, 5).map((story) => `${story.title} — ${story.source}; observed gold reaction: ${story.goldImpact}`).join('\n') || 'No corroborated recent headlines.'}
News reaction is a price observation and does not prove that the headline caused the move.

Review this setup and respond strictly in the required JSON schema.`;

  // 1. Try DeepSeek if API key is provided
  if (deepseekKey) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 24000);

      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deepseekKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: promptUser },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          const parsed = extractJson(content);
          const validated = DeepSeekReviewSchema.parse(parsed);

          const result: DeepSeekReview = {
            ...validated,
            modelUsed: 'DeepSeek (deepseek-chat)',
            reviewedAt: Math.floor(Date.now() / 1000),
          };
          reviewCache.set(cacheKey, { timestamp: Date.now(), review: result });
          return result;
        }
      }
    } catch (e) {
      console.warn('DeepSeek API call failed or timed out, trying Gemini fallback...', e);
    }
  }

  // 2. Try Gemini if GEMINI_API_KEY is present
  if (geminiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `${systemPrompt}\n\n${promptUser}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              verdict: { type: Type.STRING, enum: ['BUY', 'SELL', 'WAIT'] },
              agreement: { type: Type.NUMBER },
              reasons: { type: Type.ARRAY, items: { type: Type.STRING } },
              risks: { type: Type.ARRAY, items: { type: Type.STRING } },
              invalidation: { type: Type.NUMBER },
              comment_km: { type: Type.STRING },
              comment_en: { type: Type.STRING },
            },
            required: ['verdict', 'agreement', 'reasons', 'risks', 'invalidation', 'comment_km', 'comment_en'],
          },
          temperature: 0.2,
        },
      });

      const text = response.text || '{}';
      const parsed = extractJson(text);
      const validated = DeepSeekReviewSchema.parse(parsed);

      const result: DeepSeekReview = {
        ...validated,
        modelUsed: 'Gemini Quant Engine (gemini-2.5-flash)',
        reviewedAt: Math.floor(Date.now() / 1000),
      };
      reviewCache.set(cacheKey, { timestamp: Date.now(), review: result });
      return result;
    } catch (e) {
      console.warn('Gemini review generation failed:', e);
    }
  }

  if (options.allowRuleFallback === false) return null;

  // On-demand advisory fallback only; callers must not record it as an AI verdict.
  const fallbackReview: DeepSeekReview = {
    verdict: snapshot.verdict === 'BUY' || snapshot.verdict === 'BUY_LEANS' ? 'BUY' : snapshot.verdict === 'SELL' || snapshot.verdict === 'SELL_LEANS' ? 'SELL' : 'WAIT',
    agreement: snapshot.verdict === 'BUY' ? snapshot.buyScore : snapshot.verdict === 'SELL' ? snapshot.sellScore : 50,
    reasons: [
      `Market Regime: ${snapshot.regime.description}`,
      `HTF Alignment: H1 is ${snapshot.mtfBias.h1Bias} with M15 structure`,
      `Session Context: ${snapshot.session.currentSession} session`,
    ],
    risks: [
      `Spread volatility (${snapshot.spread})`,
      `Invalidation level breach at ${snapshot.tradePlan?.stopLoss || snapshot.currentPrice}`,
    ],
    invalidation: snapshot.tradePlan?.stopLoss || snapshot.currentPrice - snapshot.atr14 * 1.5,
    comment_km: `ការវិភាគក្បួនខ្នាត SMC: ទីផ្សារស្ថិតក្នុង ${snapshot.regime.type}។ កម្រិត Bias H1 គឺ ${snapshot.mtfBias.h1Bias}។ ពិន្ទុផ្ទៀងផ្ទាត់: Buy ${snapshot.buyScore}/100, Sell ${snapshot.sellScore}/100។ សូមអនុវត្តតាម Stop Loss (${snapshot.tradePlan?.stopLoss || 'N/A'}) ឲ្យបានម៉ឺងម៉ាត់។`,
    comment_en: `Quantitative SMC assessment: Market is navigating ${snapshot.regime.type} with H1 bias ${snapshot.mtfBias.h1Bias}. Confirmation score Buy ${snapshot.buyScore}/100 vs Sell ${snapshot.sellScore}/100. Strictly adhere to structural invalidation at ${snapshot.tradePlan?.stopLoss || 'N/A'}.`,
    modelUsed: 'Algorithmic Pure Engine (L1-L11)',
    reviewedAt: Math.floor(Date.now() / 1000),
  };

  return fallbackReview;
}

export async function askQraAssistant(params: {
  question: string;
  snapshot: FullAnalysisResult;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  customApiKey?: string;
}): Promise<string> {
  const { question, snapshot, history = [], customApiKey } = params;
  const deepseekKey = customApiKey || process.env.DEEPSEEK_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  const systemContext = `You are QRA (Quantitative Risk & Action Architect), an elite technical analyst specializing in Smart Money Concepts (SMC), ICT mechanics, and Gold (XAUUSD) microstructure.
Current Snapshot:
- Symbol: ${snapshot.symbol} (${snapshot.timeframe})
- Price: ${snapshot.currentPrice} (Spread: ${snapshot.spread}, ATR: ${snapshot.atr14})
- Engine Verdict: ${snapshot.verdict} (Grade: ${snapshot.grade}, Buy Score: ${snapshot.buyScore}, Sell Score: ${snapshot.sellScore})
- Regime: ${snapshot.regime.type} (ADX: ${snapshot.regime.adx})
- H1 Bias: ${snapshot.mtfBias.h1Bias}, H4: ${snapshot.mtfBias.h4Bias}, M15: ${snapshot.mtfBias.m15Structure}
- Active Session: ${snapshot.session.currentSession} (${snapshot.session.isKillZone ? 'Kill Zone Active' : 'Normal'})
- Trade Plan: Entry ${snapshot.tradePlan?.entryPrice || 'None'}, SL ${snapshot.tradePlan?.stopLoss || 'None'}, TP1 ${snapshot.tradePlan?.tp1 || 'None'}
Answer in clear, authoritative, professional terms. Support both English and Khmer queries.`;

  if (deepseekKey) {
    try {
      const messages = [
        { role: 'system', content: systemContext },
        ...history.slice(-4),
        { role: 'user', content: question },
      ];
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deepseekKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages,
          temperature: 0.3,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.choices?.[0]?.message?.content || 'No response generated.';
      }
    } catch (e) {
      console.warn('DeepSeek QRA chat failed:', e);
    }
  }

  if (geminiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const prompt = `${systemContext}\n\nUser Question: ${question}\nProvide a concise, direct, high-value answer.`;
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      return response.text || 'Analysis completed.';
    } catch (e) {
      console.warn('Gemini QRA chat error:', e);
    }
  }

  return `QRA Market Read for ${snapshot.symbol}: Currently trading at ${snapshot.currentPrice}. The market regime is ${snapshot.regime.type} with H1 bias ${snapshot.mtfBias.h1Bias}. Engine verdict is ${snapshot.verdict} (Grade ${snapshot.grade}). Risk invalidation level is positioned at ${snapshot.tradePlan?.stopLoss || 'N/A'}.`;
}
