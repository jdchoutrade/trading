# Signal Sources Changelog

## 2026-10-01 - Architecture audit

- Added `SOURCE_AUDIT.md` before source-model or runtime code changes.
- Confirmed there is one request-driven persisted signal path using the combined L1-L11 pipeline, not independent Indicator and Analysis streams.
- Confirmed current `signals.source` means lifecycle provenance (`live`, `paper`, `replay`, `legacy`), while AI review is an on-demand `/api/analyze` sidecar and does not gate persisted `/api/snapshot` signals.
- Documented shared technical/context inputs, AI fallback behavior, persistence/tracker/stats/History/Telegram coupling, and required migrations without inferring source type for legacy rows.
- No database rows were changed and no fake-signal purge was run. The separate purge workflow remains subject to its own explicit approval gate.

## 2026-10-01 - Source-separated signals

- Added separate immutable analytical `source` (`INDICATOR`, `ANALYSIS`, `UNKNOWN_LEGACY`) and lifecycle `origin` (`engine_live`, `replay`, `legacy_v1`, `UNKNOWN_LEGACY`) with candle-close, group, agreement, input provenance, AI state, and hash-version fields. Older `live/paper` labels migrate to unknown, not guessed source types.
- Added per-source versioned weights and threshold settings. The common L1-L11 pipeline now accepts separate regime-weight sets. Indicator excludes contextual factor weight; Analysis uses contextual weights and requires price-action confirmation.
- Added shared feed, stale/delay, divergence, event/news, risk-reward, lock and threshold gates. Official signal evaluation subscribes to configured M5/M15 closed candles; snapshot polling is read-only.
- Added uncached model review for on-demand Analysis, with no AI fallback masquerading as a real verdict. (Updated 2026-10-02: AI review is no longer in the automatic signal decision path.)
- Replaced the general signal writer with source-required `createFromEngine()` and atomic paired creation. Database uniqueness enforces idempotency per source/candle/config, and v2 hashes include source/group/provenance. Existing v1 hashes remain verifiable.
- Added source-labelled grouped Telegram setup alerts, source-labelled lifecycle alerts, `signal_created` WebSocket events, reconnect hydration, two Terminal preview lanes, source-aware History filters, source-specific live stats, and a source comparison/agreements/paired-R view.
- Confluence uses exactly one Indicator outcome per `BOTH_SAME_DIR` group, as recorded in `outcome_rules.json`.
- Added per-source Settings controls for enable, score/grade, technical-confirmation threshold, cooldown, and separate weight matrices.
- Tests use isolated in-memory/temp databases. Verification: `npm run lint`, `npm test` (35 passed), and `npm run build` passed. Main client bundle is ~575 kB minified; Vite reports the existing >500 kB chunk advisory.
- No production signal rows were changed or purged. The previously requested fake-data cleanup remains approval-gated.

## Remaining gaps

- The two decision lanes share the same feature engine, XAUUSD data, and still-hardcoded cross-asset/macro/correlation baselines; independence is configuration-level, not data-source independence.
- There is no real calendar integration or shared daily-R circuit breaker. Recent verified severe news and shock state are used as blackout gates.
- Paired bootstrap CI, random baseline, AI-value comparison, calibration by source, chart markers, My Trades source/group linkage and double-exposure warning are not implemented. Paired confidence interval explicitly returns unavailable; samples are currently insufficient.
- Settings mutation endpoints are unauthenticated, like the rest of the current API. Do not expose them to untrusted networks.
- Browser smoke check verified the source lanes, History filters, Settings controls, zero-sample comparison, and no page-level horizontal overflow at 375/768/1280 px. No formal Playwright E2E suite or live official signal generation was run. The app was started against an isolated temporary DB; the real DB was never opened by the smoke server.
# Automatic Signal Decision Path Update

- `INDICATOR` and `ANALYSIS` signals are emitted immediately after the trigger candle closes when the engine's deterministic eligibility and risk checks pass. The minimum grade is now A, matching the engine's actionable locked verdict threshold (score 75); both sources still require four technical confirmations.
- External AI review no longer delays or vetoes automatic signals. It remains available for the on-demand analysis workflow and can be stored as supplementary signal evidence when supplied by another caller.
- Existing score, grade, technical confirmation, trade-plan, risk/reward, stale-feed, divergence, spread, rollover, news-shock, cooldown, and duplicate protections remain active.

## 2026-10-02 - Quality-first defaults

- Set both source minimum scores to 75 and minimum grade to A. The Settings API rejects scores below 75 or grades below A, so the UI cannot silently configure a lower-quality signal lane.
- Added startup migration for previously saved lower thresholds; legacy settings are raised to the quality floor before validation so stale Settings saves cannot break `/api/snapshot` or signal ingestion.
- Kept the default technical requirement at 4/4; Settings allows 3/4 as the minimum, with the stricter default active for both sources.
- Removed the obsolete AI-offline signal-block control from Settings because AI review does not gate automatic signals.
- The local database has 13 records, all marked legacy or replay, and no `engine_live` outcome sample. Kept regime weights unchanged until enough live outcomes exist for empirical calibration.
- Settings saves now clamp stale client-side thresholds to the active quality floor, and API validation reports the specific invalid field instead of a generic 400 error.
