# Fake Signal and Terminal Provenance Audit

**Audit date:** 2026-10-01  
**Scope:** all rows currently in `data/gold_desk.db`, their event/outcome relationships, signal-generation code, Terminal analysis actions, and replay/test writers.  
**Method:** read-only SQLite queries and source inspection. No signal, event, or outcome rows were modified or deleted while producing this audit.

## Findings at a glance

- Current `signals` contains 13 rows: 10 `DEMO_CONFIRMED` synthetic replay records and 3 `DEMO_CONFIRMED` test-fixture signal records. There are 0 `REAL_VERIFIED` and 0 `REPLAY_LEGIT` signal rows.
- The three screenshot rows are persisted exactly as shown: identical rounded BUY/A+ 85 setups at 2650/2640/2670/2680/2690, created at 08:00:35Z, 08:01:43Z, and 08:02:43Z on 2026-10-01 (15:00-15:02 Phnom Penh time). Each is `source_feed='TEST'`, despite its misleading `source='live'` value.
- `r_max_mfe=150.89R` is not a hardcoded literal in source. It is explained by the live outcome tracker calculating `(4158.88 - 2650) / 10 = 150.888R`, rounded to 150.89, after current quotes near 4159 were applied to those test-only 2650 entries. The signal fixture is fake; the associated tick transitions and outcomes are `SUSPECT` and must be quarantined before any purge because their independent feed provenance is not verifiable.
- Replay rows marked TP3 have `r_max_mfe=0` and `r_max_mae=0`, with `reconstructed_flag=1`. They came from formula-generated bars, not a TradingView historical run. Their uniform zero excursion is a replay implementation artifact, not a live tracker measurement.
- The History source filter defaults to `ALL`, so replay and test-origin rows appear alongside purported live rows. The “I Took This” button is rendered for every system signal, including closed and replay records.
- No genuine live engine signal is evidenced in the current DB. This does not establish whether the user has entered genuine broker trades elsewhere; `my_trades` is empty in this DB, and any external journal/Telegram evidence has not been provided or checked.

## Screenshot claims checked against SQLite

| Claim | Result and evidence |
|---|---|
| Three duplicate rounded signals around 15:00-15:02 | **Confirmed.** IDs: `test_immut_1790841635925`, `test_immut_1790841703265`, `test_immut_1790841763984`. They have identical symbol, direction, entry/SL/TP1-3, score 85, grade A+, `source_feed='TEST'`, and statuses `TP3_HIT`. `created_ts` values convert to 08:00:35Z, 08:01:43Z, 08:02:43Z. The ID and exact prices match `tests/history_and_tracker.test.ts:125-148`. |
| MFE +150.89R on each test row | **Confirmed.** All three `signal_outcomes` rows contain `r_max_mfe=150.89`, `r_max_mae=0`, `r_final=3`, `status='TP3_HIT'`. Their later tick events contain bid 4158.88 and ask 4159.49 while the test signal's entry is 2650 and risk is 10. The tracker formula at `server/market/outcomeTracker.ts:178-186` yields the stored MFE from that quote. No `150.89` literal exists in production/test source. |
| Replay TP3 rows with zero MFE/MAE | **Confirmed.** Replay outcomes have `reconstructed_flag=1`; TP3 rows include IDs `replay_1790628214`, `replay_1790638114`, `replay_1790667814`, `replay_1790708314`, `replay_1790782114`, and `replay_1790792014`. All 10 replay outcome rows have zero MFE and MAE. `scripts/replayHistory.ts:145-185` writes reconstructed outcomes and does not calculate/persist excursions. |
| Replay mixed into History | **Confirmed.** `/api/signals` accepts `source`, but History defaults `sourceFilter` to `ALL` (`src/pages/SignalsPage.tsx:46,99`); the API stats default to all sources (`server/routes.ts:294-297`). |
| “I Took This” offered on closed/replay rows | **Confirmed.** The action is rendered in the system signal row without a source/status condition (`src/pages/SignalsPage.tsx:743-755`). It posts to `/api/my-trades`, a separate journal path, not to `signals` (`server/routes.ts:404-428`). |

## Classification of every persisted row

Database counts from a read-only query: `signals=13`, `signal_events=32`, `signal_outcomes=13`, `my_trades=0`, `signal_notes=0`, `drawings=0`, `settings=0`, `schema_migrations=1`. All events join to a signal; there are no orphan events. There is no `quarantine_signals` or `replay_results` table today. Stats are computed from signals rather than persisted in a stats table.

### Signals

| Class | Count | IDs | Evidence / action |
|---|---:|---|---|
| `REAL_VERIFIED` | 0 | None | No row is supported by an engine-generated closed-candle event, a real engine feed snapshot, or independent Telegram/journal verification. Hash presence alone is not provenance: the hash inputs in `server/db/sqliteStore.ts:304-314` cover only a subset of signal fields. |
| `DEMO_CONFIRMED` | 3 | `test_immut_1790841635925`, `test_immut_1790841703265`, `test_immut_1790841763984` | Exact IDs, `source_feed='TEST'`, source fixture, and rounded levels match `tests/history_and_tracker.test.ts:125-148`. They are not live engine signals even though `source='live'`. Remove from History only after the approved purge workflow; retain a quarantine copy of their suspect linked outcomes/events. |
| `DEMO_CONFIRMED` | 10 | `replay_1790602114`, `replay_1790628214`, `replay_1790638114`, `replay_1790667814`, `replay_1790675914`, `replay_1790693914`, `replay_1790708314`, `replay_1790755114`, `replay_1790782114`, `replay_1790792014` | IDs/source/tags identify replay, and `scripts/replayHistory.ts:11-35` creates 350 bars from a fixed 2650 base and sine/cosine formulas; `:35` starts generation at runtime-relative timestamps. The stored `HISTORICAL_REPLAY` feed and static `config_version='2.0.0'` do not constitute real run metadata. These are not `REPLAY_LEGIT`; no real replay date range/input feed metadata exists. Do not migrate them into `replay_results` as genuine historical testing. |
| `SUSPECT` | 0 additional signal rows | None | All 13 signal parents have a confirmed test or generated-replay origin. The linked tick/outcome evidence on the three test parents is separately suspect and must be quarantined rather than treated as verified performance. |

### Events and outcomes

| Class | Count | Evidence / required handling |
|---|---:|---|
| `DEMO_CONFIRMED` replay events | 20 | 10 `TRIGGERED`, 4 `SL_HIT`, 5 `TP3_HIT`, 1 `BE_EXIT`, each linked to a formula-generated replay signal. Not verified market data. |
| `DEMO_CONFIRMED` test initial events | 3 | One `TRIGGERED` event per test signal; `server/db/sqliteStore.ts:367-379` synthesizes it at insertion with price=entry and a fixed spread-derived bid/ask. |
| `SUSPECT` test target events | 9 | Three TP1/TP2/TP3 transitions per test signal. Their `source='tick'` labels alone do not prove provenance. The event bid/ask values near 4159 are inconsistent with the persisted test levels near 2650, and all three test rows transition on the same quote timestamps. Quarantine before removing the fake signal parents. |
| `DEMO_CONFIRMED` replay outcomes | 10 | All have `reconstructed_flag=1`; replay outcomes are derived from the synthetic bars. Six are `TP3_HIT` with zero MFE/MAE. Keep out of live History/statistics; do not call them real replay results. |
| `SUSPECT` test outcomes | 3 | `TP3_HIT`, `r_final=3`, `r_max_mfe=150.89`, `r_max_mae=0`, `reconstructed_flag=0`. MFE is consistent with the recorded 4158.88 bid against the test entry, not evidence that the test setup was genuine. Quarantine with the parent/event snapshot. |
| `REAL_VERIFIED` | 0 | No verified outcome row. |

`my_trades`, `signal_notes`, `drawings`, and `settings` have zero rows. The JSON store at `data/db.json` has empty signal/snapshot/paper-trade arrays. Thus no actual user journal record was found in these project stores, but this is not evidence about external records.

## Source trace and Terminal audit

| Path and line | Behavior |
|---|---|
| `server/engine/pipeline.ts:30-35,68-112,128-165` | `runFullAnalysisPipeline()` consumes candles/price, evaluates regime, multi-timeframe structure, liquidity, SMC, patterns, session and confirmations, then computes verdict, grade, signal lock, and trade plan. This is the core Terminal analysis function. |
| `server/market/tvFeed.ts:91-114,186-280` | TradingView client/quote and chart sessions are started and incoming quote ticks are aggregated; closed candles are published to `candleCloseListeners`. `onCandleClose()` exists at `:409-411`. No production registration of that callback to the signal emitter was found. |
| `server/market/dataProvider.ts:38-76,107-143,155-181` | XAUUSD can use a TradingView quote when available, but symbol initialization includes hardcoded starting prices/spreads. UI/API paths can fall back to these initial values; non-XAU symbols are not receiving a real tick feed from this provider. Live provenance/staleness must be enforced before signals. |
| `server/routes.ts:26-70` | `GET /snapshot` computes an analysis and calls `signalEmitter.processSnapshot(analysis)`, so a read request can persist a row. This is not a closed-candle-only ingest path. |
| `server/engine/signalEmitter.ts:12-26,32-47,90-92` | Signal gate only checks stale status, grade, direction/score, and process-local cooldown/price movement; it does not gate delayed feed, candle close, calendar/news blackout, divergence, or durable idempotency. It calls the general SQLite `addSignal()` writer. |
| `server/db/sqliteStore.ts:336-379,398-443` | Public `addSignal()` calculates a partial hash, inserts the signal, synthesizes an initial fill event, and inserts an outcome. This is not an engine-only `createFromEngine()` boundary. |
| `server/market/outcomeTracker.ts:178-186,223-350,380-421` | The live tracker computes MFE/MAE from bid/ask and writes events/outcomes. It can therefore generate a numerically correct excursion for an invalid stale test setup; it has no origin/provenance guard before registering an open signal. |
| `scripts/replayHistory.ts:11-35,45-54,83-105,145-185` | Explicit replay command generates synthetic candles, runs the engine over them, writes `source='replay'`, then reconstructs outcomes from subsequent synthetic bars. It is not invoked by `npm run dev`, but its generated rows have been persisted to the shared `signals` table. |
| `tests/history_and_tracker.test.ts:125-164` | Immutability test calls `new SqliteStore()` and `addSignal()` with `sourceFeed:'TEST'` and the exact rounded screenshot values. Store path defaults to project `data/gold_desk.db`; the test does not use a temporary DB or remove inserted rows. |
| `src/context/TerminalContext.tsx:64-86` | Initial/symbol/timeframe refresh calls `GET /api/snapshot`. Its `runAnalysisWithAnimation()` calls `POST /api/analyze` at `:181-204`; that path returns analysis/AI review and does not call the emitter. |
| `server/routes.ts:151-201,404-428,446-470` | `/api/analyze`, `/api/setup`, and `/api/my-trades` compute analysis or store a separate journal trade; none directly inserts into SQLite `signals`. Telegram send is another direct analysis/message path, not official persisted signal creation. |
| `src/pages/SignalsPage.tsx:743-755` | “I Took This” is unconditionally shown in the system signal table; it writes a separate manual execution journal. |

### Terminal data and buttons

- The indicator page displays the pipeline output, but the application does not currently have one authoritative “official signal” event shared by Terminal, History, and Telegram. The only SQLite signal emitter is currently reachable from `GET /api/snapshot`.
- The XAUUSD feed is capable of receiving TradingView quotes/candles, but non-live defaults exist and the signal gate only rejects `isStale`; it does not reject `isDelayed`. Therefore the current code cannot guarantee every Terminal analysis uses fresh, non-delayed market data.
- **Analyze** runs `POST /api/analyze` and attaches AI review; **Setup Plan** opens a UI panel (the separate `/api/setup` route only returns a plan); **Ask QRA** uses an analysis snapshot; **Telegram send** computes/formats a message. These are previews/actions, not persisted official signals. `signalLock` is computed in the engine; no button-driven official-signal lock pathway was found.
- **I Took This** stores a user execution under `my_trades`, not under `signals`; it should remain a separate journal action and should be hidden for replay/closed/unverified rows.

## Safety and purge status

- No row has been deleted, moved, quarantined, or otherwise modified for this request.
- `npm run backup:verify` most recently created and restore-verified `backups/pre-purge-2026-10-01T11-35-39-202Z.sqlite`; source, backup, and restore logical fingerprints match (`61596a527fd09b19696b2dbebb50e839d00a39238881b00bdb7ca962d4c60955`).
- `npm run purge:fake -- --dry-run` matched that backup and reported 10 `DEMO_CONFIRMED` replay signals with 20 events/10 outcomes for deletion, plus 3 `SUSPECT` test bundles with 12 events/3 outcomes to archive in `quarantine_signals`. It found 0 real-verified, replay-legit, unclassified, or journal-linked rows. No DB rows or schema changed.
- The prior `cleanup:demo` entry point was removed because it did not preserve suspect event/outcome evidence. `purge:fake` is now the only purge command; it also refuses to proceed if any signal row is unclassified or the reviewed set does not cover the table.
- Wait for explicit user approval before invoking `npm run purge:fake -- --confirm`. No deletion or quarantine has occurred.