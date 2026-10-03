# 📜 CHANGELOG — Signal History & Live Outcome Tracking System

**Release Version:** v2.1.0-institutional  
**Release Date:** 2026-10-01  
**System:** QRA Gold Terminal (XAUUSD Desk)  
**Standard:** 100% Empirical Real-Market Outcomes · Cryptographic Hash Chain · Zero Survivorship Bias

---

## 1. Executive Summary

This upgrade resolves the fundamental challenge where signals were generated and hit profit targets in the market, but were not automatically preserved in history or tracked to their ultimate outcome. The system now features an end-to-end, automated **Signal History & Live Outcome Tracking** architecture with SQLite persistence, cryptographic hash verification, spread-aware execution, and empirical statistical calculations.

---

## 2. Key Subsystems Delivered

### 2.1 SQLite Storage & Cryptographic Immutability (`server/db/sqliteStore.ts`)
- **Native Relational Storage:** Powered by Node 22 native `node:sqlite` (`data/gold_desk.db`) with WAL mode and foreign key constraints.
- **Normalized Schema:**
  - `signals`: Immutable record of every algorithmic recommendation (`id, created_ts, symbol, direction, entry_price, sl, tp1, tp2, tp3, rr_planned, score, grade, regime, session, factors, snapshot_hash, prev_hash`).
  - `signal_events`: Append-only transition log (`PENDING`, `TRIGGERED`, `TP1_HIT`, `TP2_HIT`, `TP3_HIT`, `SL_HIT`, `BE_EXIT`, `INVALIDATED`, `TIME_STOP`).
  - `signal_outcomes`: Materialized state tracking $R$-multiples, MFE, MAE, duration, and flags.
  - `my_trades`: Personal execution records linked to signal IDs.
  - `signal_notes`: User annotations and post-trade reflections.
- **SHA-256 Hash Chaining:** Every signal snapshot is cryptographically hashed with its predecessor ($H_i = \text{SHA256}(\dots + H_{i-1})$). Verified via `GET /api/signals/:id/verify` and CLI `npm run verify:history`.
- **Database Trigger Enforcement:** SQLite triggers prevent any `UPDATE` or `DELETE` on immutable signal parameters.
- **Legacy Migration:** Transparently imported legacy `data/db.json` records marked with `source = 'legacy'` without inventing fake data.

### 2.2 Spread-Aware Live Outcome Tracker (`server/market/outcomeTracker.ts`)
- **Event-Driven Execution:** Subscribes to live ticks (`price, bid, ask, spread, time`) from TradingView-API without polling.
- **Spread-Aware Fill & Exit Logic:**
  - **BUY:** Enters on `Ask <= entryPrice`. Measures Stop Loss and Take Profits on `Bid`.
  - **SELL:** Enters on `Bid >= entryPrice`. Measures Stop Loss and Take Profits on `Ask`.
  - Captures actual fill prices and accounts for gap slippage beyond SL levels.
- **Multi-Stage Lifecycle:**
  - On `TP1_HIT`, automatically arms Break-Even (BE) at entry $+ 0.05$ buffer.
  - Tracks running $R$, Maximum Favorable Excursion (MFE), and Maximum Adverse Excursion (MAE).
- **Conservative Same-Bar Ambiguity Resolution:** If high and low breach both TP and SL in the same bar, assumes SL hit first and marks `ambiguous_flag = 1`.
- **Feed Interruption Handling:** When feed is stale ($> 3000\text{ms}$), pauses tracking. On recovery, rehydrates and backfills chronological candle gaps, marking events as `source = 'reconstructed'`.

### 2.3 Statistical Engine & Sample Gating (`server/stats/statsEngine.ts`)
- **Wilson 95% Confidence Interval:** Binomial proportion interval for real win rates.
- **Strict Minimum Sample Size Rule (Iron Rule 2):**
  - If total resolved sample $n < 30$, percentages are replaced with an explicit `"insufficient sample (n=...)"` badge while displaying raw counts ($W / L / BE$).
  - Sub-segments (by session, grade, regime, direction) require $n \ge 20$.
- **Empirical Metrics:**
  - Expectancy ($R/\text{trade}$), Profit Factor ($\sum R^+ / \sum |R^-|$), Max Drawdown in $R$.
  - Separate TP1, TP2, TP3 hit rates and Stop Loss hit rate before TP1.
  - Chronological cumulative $R$ equity curve and $R$-distribution histogram.

### 2.4 Automated Lifecycle Telegram Dispatcher (`server/telegram/bot.ts`)
- Structured notifications in Khmer and English:
  - 🚀 `SIGNAL TRIGGERED` (fill price, spread, initial risk).
  - 🎯 `TP1 / TP2 / TP3 HIT` (realized $R$, elapsed time, Break-Even arming notification).
  - 🛑 `STOP LOSS HIT` (exact exit price, realized $R$).
  - ⚪ `BREAK-EVEN EXIT` (partial profit secured).
  - ⏱ `TIME-STOP` / ❌ `INVALIDATED`.

### 2.5 Institutional Frontend Terminal (`src/pages/SignalsPage.tsx` & `OverviewPage.tsx`)
- **Interactive Views:**
  - `System (All Signals)`: Virtualized table with search, direction/grade/session/regime/status filters.
  - `My Actual Trades`: Personal trading journal logged via **"I took this"** button.
  - `Compare View`: Execution gap ($\Delta R$) and entry slippage analysis between broker and algorithm.
- **Signal Detail Drawer:**
  - Price level inspection with entry, SL, TP, and actual hit markers.
  - Chronological timeline events with timestamps, spread, and sources.
  - Interactive SHA-256 cryptographic verification modal.
  - In-app trade notes and reflection editor.
- **Visual Analytics:** Interactive Cumulative $R$ Equity Curve, $R$-Distribution Histogram, Score Calibration Table, and Factor Attribution.
- **Overview Page:** "Today / This Week / All-Time" summary cards, live Open Signals progress cards (`SL ← entry → TP1/2/3`), and last 5 closed signals strip.
- **Export Capabilities:** One-click CSV and JSON exports for external auditing.

---

## 3. Configuration & Scripts

- `outcome_rules.json`: Centralized classification rules ($R \ge +0.25R$ win, $R \le -0.25R$ loss), spread buffers, and sample gating thresholds.
- `npm run verify:history`: Audits 100% of cryptographic hash chain records and event-to-outcome consistency.
- `npm run replay:history`: Deterministic walk-forward backfill on historical bars with out-of-sample statistical validation.

## 4. History Corrections

- TP1 and TP2 are intermediate tracker states, so they remain open and are no longer counted as completed trades in summary statistics, equity curves, or R distributions.
- A trade contributes to realized performance only after a terminal outcome includes a finite realized R value; this avoids substituting the planned reward/risk value for an unfinished outcome.
- The History page refreshes signals and outcome statistics every 15 seconds while visible, and search now includes symbol and direction.
