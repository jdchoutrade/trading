# Data and Responsiveness Audit

**Audit date:** 2026-10-01  
**Scope:** signal/stat producers, current SQLite and JSON data, and primary app/mobile layout.  
**Method:** source inspection and read-only queries against `data/gold_desk.db`. No rows were changed.

## Executive finding

The current database has no verified live-engine signals. Its 13 signals are 10 replay records created from generated candles and 3 immutability-test records. The earlier version of this audit incorrectly described the replay data as historical market replay and treated `source='live'` as evidence of real signals. Those claims are withdrawn. No classification below relies on the source label alone.

## Signal and statistic producers

| Location | Observed behavior | Audit conclusion |
|---|---|---|
| `server/routes.ts` `GET /snapshot` | Runs the analysis pipeline on request and calls `signalEmitter.processSnapshot()`. | Signal persistence depends on polling/request cadence, not a candle-close event. |
| `server/engine/signalEmitter.ts` | Accepts non-stale analysis, checks a process-local 15-minute/price cooldown, calls `sqliteStore.addSignal()`, registers the outcome tracker, then sends Telegram. | It does not gate delayed feed, calendar/circuit-breaker state, or candle close. The cooldown is not durable/idempotent across restart. |
| `server/db/sqliteStore.ts` `addSignal()` | Public general-purpose writer inserts a signal and initializes its outcome/event. | Not an engine-only repository gate. Hash input covers only id, timestamp, symbol, direction, entry, SL, TP1, and previous hash. |
| `server/market/tvFeed.ts` | Receives quote ticks and notifies listeners on closed aggregated candles. | Candle-close callback exists, but no signal-emitter subscription was found in startup/wiring. |
| `scripts/replayHistory.ts` | `generateBacktestCandles()` synthesizes 350 bars from a fixed 2650 price and sine/cosine formulas, then writes `source='replay'` signals. | Synthetic replay, not TradingView historical data. It is manually invoked, not an actual-candle replay. |
| `server/routes.ts` `POST /backtest` | Runs the engine over existing candles, then evaluates later candles and returns simulated signals/stats. | Does not insert into `signals`, but uses future bars for outcomes and must remain labeled simulation, not live history. |
| `tests/engine.test.ts` | Generates randomized test candles using `Math.random()`. | Test-only fixture code, currently outside the requested `tests/fixtures/` exception. |
| `tests/history_and_tracker.test.ts` | Calls `SqliteStore.addSignal()` using the real default DB path and `test_immut_<timestamp>` IDs; no cleanup is shown. | Tests have written persistent rows into the project DB. This is the proven source of the three test rows. |
| `server/db/sqliteStore.ts`, `server/market/outcomeTracker.ts` | Use `Math.random()` to generate event IDs. | Random identifiers, not prices/signals; still violate a literal repository-wide `Math.random` guard. |
| `server/db/sqliteStore.ts` `migrateLegacyJson()` | Imports JSON signals and fills missing price/score/session/outcome fields with defaults (including 2650, 75, and 0.35). | Legacy values with missing fields cannot be considered verified from the resulting SQLite row alone. Current `data/db.json` has an empty `signals` array. |
| `server/db/store.ts` | Initializes paper account balance 10000, average spread 0.35, and provides `addSignal`, `addPaperTrade`, and manual close methods. | These are defaults/manual paper-trade features; this JSON store is separate from SQLite history. Its current `signals` array is empty. |
| `server/routes.ts` | Manual endpoints exist for `/my-trades`, `/paper-trades`, `/live-trackers`; notes are separate. | No additional direct HTTP endpoint inserting into SQLite `signals` was found. The SQLite writer remains callable outside an engine-specific gate. |
| `server/intel/marketIntelligence.ts` | Initializes cross-asset prices/change, risk-off confidence/sample counts, GRI, correlations, macro data, and scenario values as hardcoded baselines. Fetch failures preserve old baselines. | Several values can appear live without live provenance/freshness. These are not signal rows, but conflict with the no-placeholder-data requirement. |
| `server/engine/pipeline.ts`, `server/engine/L9_session.ts`, `server/market/tvFeed.ts`, UI/context | Default spread 0.35, fallback price 2650, fallback volume 10, and initial UI spread 0.35 occur in code. | Fallback numeric values can be presented as market state when feed data is absent; should become unavailable/stale state. |
| `server/stats/statsEngine.ts`, `server/db/store.ts` | Compute summary/calibration/attribution from supplied signal records. API defaults to all SQLite sources. | Current aggregates can mix replay, test, and live-labeled records. A sample-size gate exists in parts of the UI/API, but provenance must be filtered first. |

## Current database classification

Read-only SQLite inspection of `data/gold_desk.db` found:

| Table | Rows | Classification/evidence |
|---|---:|---|
| `signals` | 13 | 10 `DEMO_CONFIRMED` replay rows and 3 `DEMO_CONFIRMED` test rows; 0 `REAL_VERIFIED`; 0 supported `REAL_LEGACY`. |
| `signal_events` | 32 | 20 events belong to replay IDs, 12 to test IDs; no orphan events. Replay events: 10 TRIGGERED, 4 SL_HIT, 5 TP3_HIT, 1 BE_EXIT. Test events: 3 each TRIGGERED, TP1_HIT, TP2_HIT, TP3_HIT. |
| `signal_outcomes` | 13 | 10 replay outcomes marked reconstructed; 3 test outcomes marked not reconstructed. No verified live outcomes. |
| `my_trades` | 0 | Empty. |
| `signal_notes` | 0 | Empty. |
| `drawings` | 0 | Empty. |
| `settings` | 0 | Empty. |
| `schema_migrations` | 1 | Schema metadata only. |

Replay IDs (10): `replay_1790602114`, `replay_1790628214`, `replay_1790638114`, `replay_1790667814`, `replay_1790675914`, `replay_1790693914`, `replay_1790708314`, `replay_1790755114`, `replay_1790782114`, `replay_1790792014`. The `source='replay'` and `tags=["replay","backtest"]` are consistent with the script, and inspection of that script proves its input bars are formula-generated. Classify these signals, outcomes, and 20 events as `DEMO_CONFIRMED` for this data-cleanup purpose; they are not market-history replay.

Test IDs: `test_immut_1790841635925`, `test_immut_1790841703265`, `test_immut_1790841763984`. Evidence: persisted `source_feed='TEST'`, matching ID prefix and fixed entry/SL/TP values from `tests/history_and_tracker.test.ts`, which calls `SqliteStore.addSignal()` against the default DB. Their `source='live'` is not evidence of a live signal. Classify the 3 signals, 3 outcomes, and 12 events as `DEMO_CONFIRMED` test artifacts.

`data/db.json` has empty `signals`, `snapshots`, `paperTrades`, `liveTrackers`, and `drawings` arrays; its balance/spread values are defaults, not observed account/feed measurements. Existing `data/*.backup.1790842757481` files are not the requested pre-cleanup backup and have not been restore-verified. The active SQLite database has WAL/SHM sidecar files, so a raw file copy is not a sufficient verified-backup procedure.

**No data has been deleted, quarantined, or altered.** There are no rows to classify as real verified from available evidence. Whether to permanently remove the 13 confirmed non-production signal records remains subject to the requested explicit approval after a verified backup and dry-run.

## Responsive UI findings

| Surface | Evidence and issue |
|---|---|
| App shell and navigation | `src/App.tsx` uses `h-screen w-screen`; `Sidebar.tsx` always renders `w-56` (224px). No mobile bottom navigation or responsive sidebar is present. Notch/safe-area handling and `100dvh` are absent. |
| Header | `Header.tsx` keeps brand, quote, symbol tabs, timeframe tabs, analyze, AI, language, and shortcuts in fixed horizontal flex groups. Several controls use 4-12px vertical padding, below 44px touch height. |
| Status strip | `StatusStrip.tsx` is a dense, nowrap row with horizontal overflow; this is internally scrollable but not adapted into a compact mobile status view. |
| Signals history | `SignalsPage.tsx` renders a 10-column table (inside an overflow wrapper), wide analytics tables, small controls, and a right-side drawer. There is no mobile card-list alternative, origin filter, or empty-state text matching the requested Khmer message. Data initially loads once and then requires manual refresh/source change; no signal-created subscription was found. |
| Overview and paper trading | `OverviewPage.tsx` and `PaperTradingPage.tsx` contain tables in local horizontal scrollers, not card layouts. The scrollers limit page-wide overflow but do not make dense records comfortable on phones. |
| Live chart | `TradingViewLivePage.tsx` uses a custom Lightweight Charts instance, but initializes using container dimensions and only listens to `window.resize`; controls remain dense horizontal toolbars, touch gestures are not explicitly configured, and the setup panel is fixed at 420px. No jump-to-live or candle countdown control was found. |
| Desk | Some grids use responsive Tailwind breakpoints, but correlation data is hardcoded and panels have not been verified on actual mobile viewports. |
| Global/mobile/PWA | `src/index.css` has no viewport media queries or safe-area/touch rules. `index.html` and the project contain no manifest/service worker or Playwright config. No mobile browser/Lighthouse measurements have been run. |

## Required safety sequence and next work

1. Create a timestamped SQLite-consistent backup using SQLite's backup mechanism; restore it to a separate file and verify schema/counts/hash-chain before any destructive operation. `npm run backup:verify` completed successfully.
2. `npm run cleanup:demo -- --dry-run` completed against the matching backup: 13 confirmed signals, 32 linked events, 13 outcomes, 0 linked notes/trades, and 0 suspect rows. No data changed. Request explicit approval before deleting any DB row.
3. Only after approval, transactionally delete confirmed test/replay artifacts and verify all linked counts. Do not treat the current synthetic replay as genuine historic market data.
4. Then address the single closed-candle live-ingest path, durable idempotency and gating, true live bid/ask outcome tracking, and derived statistics; preserve manual journal/trade rows separately.
5. Implement mobile navigation, compact/mobile history cards, chart touch behavior, safe areas, reconnect/offline states, and PWA static-asset-only caching; run viewport and Lighthouse tests and report actual results.
