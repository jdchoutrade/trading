# QRA Gold Terminal — Advanced SMC/ICT Technical Analysis for XAUUSD

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-cyan.svg)](https://react.dev/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-38bdf8.svg)](https://tailwindcss.com/)
[![Engine](https://img.shields.io/badge/Architecture-L1--L12_Pipeline-gold.svg)]()

> **English:** High-precision Smart Money Concepts (SMC) & ICT quantitative trading terminal for XAUUSD (Gold) and multi-asset markets with AI verification, real-time liquidity mapping, and automated confirmation engine.
>
> **ភាសាខ្មែរ:** ប្រព័ន្ធ Technical Analysis កម្រិតខ្ពស់សម្រាប់ XAUUSD (Gold) ដំណើរការដោយ Smart Money Concepts (SMC), ICT, Multi-Timeframe Alignment, និង AI Verification យ៉ាងពេញលេញ និងត្រឹមត្រូវតាមក្បួនខ្នាតស្ថាប័នធនាគារ។

---

## 🏛️ 12-Step Quantitative Pipeline Architecture

```text
MARKET DATA (Real-Time Feed & Live Ticks)
   ↓
[L1] MARKET REGIME: Trend / Range / High-Volatility (ADX, ATR percentile, BB width)
   ↓
[L2] MULTI-TIMEFRAME: H1 Bias → M15 Structure → M5/M1 Entry Trigger
   ↓
[L3] LIQUIDITY MAP: Swing High/Low, Session H/L (Asia/London/NY), PDH/PDL, Round Levels
   ↓
[L4] SMC ENGINE: BOS / CHoCH / Order Block / FVG / Premium-Discount / Liquidity Sweeps
   ↓
[L5] MOMENTUM: RSI (+divergence), MACD slope, ADX/DI Cross
   ↓
[L6] VOLATILITY: ATR(14), Bollinger Squeeze & Expansion
   ↓
[L7] VOLUME: Volume Spike (>1.8× SMA20), Session VWAP (±1σ bands)
   ↓
[L8] CANDLE PATTERNS: Engulfing, Rejection Wick (≥60% range), Inside-bar break
   ↓
[L9] SESSION FILTER: Kill Zones (London, NY, Overlap) & Rollover Spread Block
   ↓
[L10] CONFIRMATION ENGINE: Weighted scoring (S, H, F, K, O, T, REG, 4H, D1, VWAP, MOM, RAIL, BLOCK)
   ↓
[L11] SIGNAL SCORE 0–100: Grades A+ (≥85), A (≥75), B (≥65), C (≥50), X (<50) + 20min Signal Lock
   ↓
[L12] AI REVIEW (DeepSeek / Gemini): Second opinion, agreement %, strict JSON schema, Khmer/EN
   ↓
FINAL OUTPUT: BUY / SELL / WAIT (+ Entry, SL, TP1/TP2/TP3, RR, Lot Size)
```

---

## ⚡ Key Features

1. **Pure Quantitative Engine (No Look-Ahead Bias):**
   - Pure functions inside `/server/engine/*.ts` thoroughly unit-tested with Vitest.
   - Dynamic weight adjustment based on Market Regime (Trend, Range, High Volatility).
2. **True Liquidity & SMC Mapping:**
   - Detects **BOS / CHoCH** strictly via candle body close.
   - **Order Block (OB)** displacement calculation and mitigation tracking.
   - **Fair Value Gaps (FVG)** imbalance identification and fill percentage tracking.
   - **Liquidity Sweeps** (sweep high/low with sharp wick rejection).
3. **Multi-Timeframe Hierarchy:**
   - Macro H1 / H4 dealing range bias.
   - Never triggers counter-trend entries against H1 bias unless confirmed by M15 CHoCH with Score ≥ 85.
4. **Session Killzones & Spread Guard:**
   - Asia Build: 00:00 - 07:00 UTC
   - London Open Killzone: 07:00 - 10:00 UTC
   - New York Open Killzone: 12:30 - 15:30 UTC
   - Overlap Window: 12:00 - 16:00 UTC
   - **Rollover Block (21:45 - 23:15 UTC):** Trading is strictly halted during wide-spread rollover.
5. **AI Second Opinion (DeepSeek & Gemini):**
   - Rate-limited and cached (60s).
   - Strict JSON validation with Zod.
   - Explanations in Khmer (ភាសាខ្មែរ) and English.
6. **Source-Tagged Signal History & Live Outcome Tracking:**
   - **SQLite Relational Persistence:** Immutable storage (`data/gold_desk.db`) with cryptographic SHA-256 hash chaining.
   - **Spread-Aware State Machine:** Automatic execution tracking (`PENDING` → `TRIGGERED` → `TP1` / `BE` / `TP2` / `TP3` / `SL`).
   - **Empirical Statistics:** Wilson 95% Confidence Intervals, Expectancy ($R/\text{trade}$), Profit Factor, Drawdown, and sample size gating ($n < 30$ insufficient sample rule).
   - **Broker Execution Sync ("I took this"):** Personal journal linked to system signals with execution gap and slippage tracking.
   - **Automated Telegram Alerts:** Real-time lifecycle notifications (Triggered, TP Hit, SL Hit, Break-Even) in Khmer & English.
7. **Risk Management & Paper Trading:**
   - Automatic lot sizing based on account equity and risk % (1.0% risk rule).
   - Real-time PnL & pip calculation.
8. **Telegram Broadcast:**
   - Clean HTML-formatted trade alerts with entry, stop loss, targets, and invalidation levels.

## Signal Sources / ប្រភព Signal

The terminal keeps two analytical sources separate:

- **INDICATOR** is deterministic SMC/price-action scoring using candle structure, liquidity, OB/FVG, regime and technical confirmations.
- **ANALYSIS** uses separate weights and must validate the 12-stage pipeline, including the core SMC factors and a valid trade plan. A real model second opinion runs asynchronously for qualified live candidates when `LIVE_AI_REVIEW=true` and a DeepSeek or Gemini key is configured; it never delays or vetoes the technical signal.
- Both streams share the same live quote/candle feed and the same spread-aware outcome tracker. They are not independent market-data samples.
- Indicator signals support both long (BUY) and short (SELL) directions on the live 5m trigger by default. A direction still needs a valid technical score, trade plan, and risk checks; weak readings such as the 35–44 scores shown in the supplied screenshot remain WAIT.
- Live signals are evaluated from the forming 5m candle as price ticks arrive, with a closed-candle pass retained for history and duplicate protection. Intrabar records carry the `intrabar-live` tag. Set `SIGNAL_TRIGGER_TF=15m` only when you want the slower 15m structure; the default is `5m`. `LIVE_SIGNAL_SCAN_INTERVAL_MS` controls the minimum interval between live scans (default `750`); live AI second opinions are limited to one request per five minutes when a candidate qualifies.
- The calendar combines the published Forex Factory weekly JSON export with the U.S. BLS release calendar. It displays the event source and available actual/forecast/previous values in Cambodia time, and passes high-impact events into analysis. It uses the current week's feed rather than mirroring Forex Factory's historical database.
- `signals.source` is the analytical type (`INDICATOR`, `ANALYSIS`, or `UNKNOWN_LEGACY`). `signals.origin` is lifecycle provenance (`engine_live`, `replay`, `legacy_v1`, or `UNKNOWN_LEGACY`). Old records are never guessed into an analytical type.
- History and source statistics default to `origin=engine_live`; Replay remains separate. Confluence is a view over `BOTH_SAME_DIR` groups and uses one Indicator outcome per group for its summary.
- Source configurations and independent weight matrices are `weights.indicator.json` and `weights.analysis.json`; the Settings page edits them separately. Missing or stale external context is shown as unavailable and does not receive a fabricated value.
- Until at least 30 verified outcomes accrue for a source/segment, percentage-based metrics display `insufficient sample (n=...)`. The source comparison currently does not claim a bootstrap interval, random baseline, or measured AI value.

The Settings API has no authentication in the current application. Do not expose it directly to an untrusted network; use an authenticated HTTPS reverse proxy before remote access.

សញ្ញាមានពីរប្រភព៖ **INDICATOR** និង **ANALYSIS**។ វាវាយតម្លៃ candle កំពុងបង្កើតតាម live tick ហើយរក្សា closed-candle pass ដើម្បីការពារសញ្ញាស្ទួន។ AI second opinion រត់បន្ទាប់បន្សំសម្រាប់ candidate ដែលមានលក្ខណៈគ្រប់គ្រាន់ ហើយមិនពន្យារពេល ឬបិទ technical signal ទេ។

---

## 🛠️ Verification & Replay Scripts

```bash
# Verify cryptographic hash chain & outcome determinism
npm run verify:history

# Run deterministic historical walk-forward replay backfill
npm run replay:history

# Verify live TradingView feed connectivity & latency
npm run verify:feed

# Compare multi-broker quotes (OANDA vs FOREXCOM vs TVC)
npm run symbols:compare
```

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Run unit tests
npm test

# 3. Start development server
npm run dev
```

Visit `http://localhost:3000` to access the terminal.
