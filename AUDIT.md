# 📋 QRA Gold Terminal — System Audit (V1 vs V2 Requirements)

**Audit Date:** 2026-09-30  
**Auditor:** Senior Quantitative & Full-Stack Systems Architect  
**Status:** In-Depth Codebase Audit Completed Prior to Code Execution  

---

## 1. Executive Summary & V1 Code Assessment

An exhaustive audit of the existing codebase (`server/` and `src/`) was conducted to benchmark against the **Zero-Fake / 100% Real-Time & Real Data Only** mandate. While the core mathematical engine (L1 to L11 indicators, regime, structure, and scoring logic) is fundamentally sound and passes 15 Vitest tests, several critical architectural components in V1 relied on simulations, third-party iframes, mock initializations, or unverified statistical placeholders.

---

## 2. Detailed Findings: What Works, What is Broken, What is Fake/Hardcoded

| Component | Current State in V1 | Problem / Fake / Hardcode Identified | Required V2 Upgrade |
| :--- | :--- | :--- | :--- |
| **Market Data Feed** | `server/market/dataProvider.ts` | ❌ `startLiveTickLoop()` simulates micro-fluctuations using `Math.random()`. `buildHighFidelityCandles()` uses `Math.random()` when Yahoo Finance fails. Default prices hardcoded (`2658.50`). | ✅ Replace with real dual-feed provider architecture (`DataProvider` interface) using real market WebSocket and HTTP tick/candle streams (TradingView API / Binance PAXG Gold real ticks / live quotes). Implement dual-provider cross-check (Divergence warning if > 0.6 ATR). |
| **Forming Candle Update** | `dataProvider.ts` & `IndicatorsPage.tsx` | ❌ Forming candle was only updated every 1500ms or on interval, not pushed immediately on every tick to `lightweight-charts`. | ✅ Update forming candle on **every incoming tick** via `series.update()` with strict UTC candle boundary validation. |
| **Live Chart Interface** | `src/pages/TradingViewLivePage.tsx` | ❌ Embeds a third-party `s.tradingview.com/widgetembed` iframe. Uncustomizable, delayed feeds, out-of-sync with internal SMC indicators. | ✅ **Delete TradingView widget/iframe completely.** Build custom unified `LiveChart` powered by `lightweight-charts` with dark-gold styling, custom toolbars, tick animations, drawing tools, and crosshair sync. |
| **Database & Signals** | `server/db/store.ts` | ❌ `seedInitialHistoryIfEmpty()` seeds 3 fake signals (`sig_101`, `sig_102`, `sig_103`) with synthetic R values and dates. | ✅ Wipe out synthetic signals. Only record real signals generated live or through verified backtests. Enforce rule: if sample size $n < 30$, show `"insufficient sample (n=...)"` instead of fake win rates. |
| **Stats & Attribution** | `src/pages/SignalsPage.tsx` | ❌ Hardcoded stats: Profit Factor `2.84`, Max Drawdown `-4.2%`, static equity curve `[10, 11.5, ...]`, static factor attribution percentages (`84%`, `79%`). | ✅ Calculate all metrics dynamically from immutable DB signals. Add **Calibration Table** (score buckets vs empirical win rate with Wilson confidence intervals) and Factor Attribution. |
| **Desk Chart Page** | Missing in V1 | ❌ No unified macro & cross-asset desk screen. | ✅ Create `DeskPage` combining XAUUSD `LiveChart`, cross-asset strip (DXY, US10Y, US02Y, VIX, Silver, Oil, etc.), rolling correlation matrix, macro data, and Signal Fusion waterfall. |
| **Market Intelligence (News/Geo)** | Missing in V1 | ❌ No real news ingestion pipeline or geopolitical index. | ✅ Create `sources.json` registry (GDELT, RSS, official releases), News Classification engine with Zod schema, real price-reaction Impact Table, Shock Detector, Geopolitical Risk Index (GRI), and Scenario Engine. |
| **Trade Tracker** | `PaperTradingPage.tsx` | ❌ Basic manual trade tracker without spread awareness or multi-stage lifecycle (Triggered -> TP1 -> BE -> TP2 -> Trailing). | ✅ Implement **Live Trade Tracker** with bid/ask spread awareness, automatic trailing to break-even at TP1, and time-stop rules. |
| **Verification & Tools** | Missing in V1 | ❌ No feed verification script to measure tick rate, p95 latency, and gap mismatch. | ✅ Implement `npm run verify:feed` diagnostic tool. |

---

## 3. Diagnosis: Why V1 Chart Did Not Sync with the Real Market

1. **Synthetic Tick Fallback:** When external HTTP requests were delayed, `dataProvider.ts` fell back to generating ticks via `Math.random()`, resulting in drift from true broker quotes.
2. **IFrame Decoupling:** The TradingView iframe widget operates in a sandbox with delayed free exchange quotes (15-min delayed on certain symbols without credentials), completely decoupled from the server's WebSocket ticks.
3. **Lack of Dual-Source Cross-Check:** No secondary validation provider existed to flag price divergence or verify tick accuracy against real gold spot rates.

---

## 4. Planned Action Plan for V2

1. **Step 1:** Establish `DataProvider` interface with Primary (real TradingView/live quote streaming) + Secondary cross-check provider (TwelveData / Binance PAXG Gold spot tick stream). Add Price Divergence and Stale guards.
2. **Step 2:** Eliminate all `Math.random()`, mock data, and hardcoded values across server and client.
3. **Step 3:** Build custom `LiveChart` using `lightweight-charts` with real tick updates, drawing tools, and overlay synchronization, removing the TV iframe completely.
4. **Step 4:** Build the **Desk Page** (Cross-asset strip, rolling correlation matrix, macro data, Signal Fusion waterfall).
5. **Step 5:** Build **Market Intelligence Pipeline** (`sources.json`, GDELT/news ingestion, classification, real Impact Table, Shock Detector, GRI, Scenario Engine, Risk-off classifier).
6. **Step 6:** Implement Calibration Table & Factor Attribution in Signals page ($n < 30 \implies$ "insufficient sample").
7. **Step 7:** Implement Live Trade Tracker with spread-aware lifecycle execution.
8. **Step 8:** Provide diagnostic feed verification script (`npm run verify:feed`) and comprehensive unit tests.
9. **Step 9:** Document all modifications in `CHANGELOG_V2.md`.
