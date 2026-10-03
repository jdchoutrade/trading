# Signal Source Architecture Audit

**Date:** 2026-10-01  
**Scope:** signal decision path from live feed through engine, persistence, tracker, statistics, History, and Telegram. This is a source-code audit; no database rows were changed.

## Executive finding

The current application does **not** have separate INDICATOR and ANALYSIS signal streams. It has one persisted signal path: `GET /api/snapshot` runs `runFullAnalysisPipeline()` and passes its single verdict/grade/trade plan to `SignalEmitter.processSnapshot()`, which writes one SQLite row. The pipeline already mixes price-action/SMC features with cross-asset, correlation, risk-off, GRI, and news factors. The `source` field currently means data lifecycle (`live | paper | replay | legacy`), not analytical source. AI is not part of that persisted `/snapshot` decision: `requestAiReview()` is called by the on-demand `/api/analyze` route, and its result is only attached to that request's response.

Therefore the requested separation is a **new analytical architecture**, not a matter of renaming existing source labels. Existing rows cannot be safely backfilled as INDICATOR or ANALYSIS based on their old `source` value; they must become `UNKNOWN_LEGACY` and stay out of default source statistics.

## (a) Current module map

| Concern | Current modules | Actual role |
|---|---|---|
| Live market input | `server/market/tvFeed.ts`, `server/market/dataProvider.ts`, `server/market/aggregator.ts` | TradingView quote/chart sessions provide quotes/candles; `TvFeedService` emits a closed-candle callback. Provider also keeps initial/default prices and feed health state, so a future official source gate must use verified freshness rather than treating any analysis result as live. |
| Price-action/indicator analysis | `server/engine/L1_regime.ts`, `L2_multitimeframe.ts`, `L3_liquidity.ts`, `L4_smc.ts`, `L5_L8_patterns.ts`, `L9_session.ts` | Calculate regime, HTF structure/bias, liquidity, BOS/CHoCH, OB/FVG/sweeps, momentum/volume/VWAP/patterns, and session context. |
| Combined confirmation/scoring | `server/engine/L10_confirmation.ts`, `L11_scoring.ts`, `pipeline.ts` | L10 combines technical factors with external cross-asset, correlation, macro/news/geo/risk-off inputs and hard blocks; L11 converts the resulting single buy/sell scores to one verdict, grade, lock and trade plan. `runFullAnalysisPipeline()` is the common entry point used by snapshot, analyze, setup, Telegram and backtest endpoints. |
| AI review | `server/ai/deepseek.ts` | `requestAiReview()` calls DeepSeek, optionally Gemini, and currently has a deterministic algorithmic fallback. It returns an advisory verdict/review; it is not currently an autonomous signal producer. The fallback must not be mistaken for a real AI verdict in an ANALYSIS stream. |
| Persistence/identity | `server/db/sqliteStore.ts`, `server/types.ts` | `signals.source` is `live | paper | replay | legacy`; it describes lifecycle/origin, not INDICATOR versus ANALYSIS. Writer accepts a general signal object. Existing schema has no `group_id`, agreement, candle close identity, or input provenance. |
| Signal creation | `server/engine/signalEmitter.ts`, `server/routes.ts` | One `processSnapshot()` writer is called from `GET /api/snapshot`. Its process-local cooldown and grade/direction checks operate on a single hybrid analysis. The call is request-driven, not wired to `TvFeedService.onCandleClose()`. |
| Tracking | `server/market/outcomeTracker.ts` | One shared spread-aware bid/ask tracker tracks all registered rows. It does not distinguish analytical source, which is appropriate for fair comparisons once the signal source is persisted immutably. |
| Statistics/API | `server/stats/statsEngine.ts`, `server/routes.ts` | Metrics calculate over input arrays; `/api/signals/history/stats` defaults to all `source` values, so live/replay/legacy can be mixed. It has no indicator/analysis/confluence filters or paired comparison. |
| History/Terminal UI | `src/pages/SignalsPage.tsx`, `src/pages/IndicatorsPage.tsx`, `src/context/TerminalContext.tsx`, `src/components/StatusStrip.tsx` | History currently filters `ALL/live/replay`. Terminal displays one combined verdict/score/grade/plan. No separate lanes, source comparison, agreement badge, or partner links exist. |
| Notifications | `server/telegram/bot.ts`, `server/engine/signalEmitter.ts`, `server/market/outcomeTracker.ts` | Setup formatting takes one `FullAnalysisResult`; outcome formatting receives one signal and event. There is no source prefix, group/agreement message, or paired emission merge. |

## (b) Coupling and shared inputs

The current layers are tightly coupled around the `FullAnalysisResult` contract:

1. `pipeline.ts` computes regime, MTF bias, liquidity, structure, OB/FVG/sweeps, patterns, volume/VWAP and session, then passes those outputs together with cross-assets, correlations, stories, risk-off and GRI to one L10 confirmation call.
2. L10 creates both the price-action factors (`S`, `H`, `F`, `K`, `O`, `T`, `REG`, etc.) and contextual factors (`XA`, `COR`, `MAC`, `NEWS`, `GEO`) in the same directional score. L11 receives only `buyScore`/`sellScore`, not a source-specific score/config.
3. Both prospective sources necessarily share raw XAUUSD candles/ticks, trigger candle close, core structure/regime/session calculations and the common safety gates. Independence is therefore decision/input separation, not independent market data. Exact overlap/provenance must be recorded, and confluence is correlation of decisions, not independent evidence.
4. `DEEPSEEK_API_KEY` or `GEMINI_API_KEY` can enable external AI review in the on-demand path. If neither is configured or an API fails, the current review function returns an algorithmic fallback. That output is not proof of AI participation and must be labelled `RULE_FUSION_ONLY` or absent in any future ANALYSIS signal.
5. There is currently no independent `weights.indicator.json` / `weights.analysis.json`, per-source lock/cooldown, source-specific risk threshold, shared daily risk circuit breaker, calendar blackout gate, or analysis-versus-indicator overlap metric.

## (c) Where persisted signals come from now

The only production call site found for `signalEmitter.processSnapshot()` is `server/routes.ts` `GET /api/snapshot`. It persists one signal from the combined deterministic L1–L11 result. The pipeline result can include external context inputs, but `/snapshot` does not await `requestAiReview()`, so the stored signal is not currently a DeepSeek-verdict signal. `POST /api/analyze` calls `requestAiReview()` and adds it to an in-memory response only; `/setup` and `/telegram/send` are also analysis/notification paths and do not persist a signal through the emitter. Replay and test code call the general SQLite writer independently and use the existing lifecycle/origin labels; those are not production live streams.

**Conclusion:** current persisted source is one mixed rule-based Fusion/SMC signal (plus replay/test artifacts documented in `FAKE_AUDIT.md`), not two independently measured sources and not an AI-gated ANALYSIS stream.

## (d) Required schema, behavior, and UI changes

| Layer | Required change |
|---|---|
| SQLite/model | Preserve old lifecycle provenance separately (rename old `source` to `origin`); introduce immutable analytical `source` (`INDICATOR`, `ANALYSIS`, `UNKNOWN_LEGACY`), `candle_close_ts`, `group_id`, `agreement`, and `input_provenance_json`. Keep AI verdict/model fields nullable and explicitly mark AI state. Add unique idempotency over source, symbol, timeframe, close timestamp, direction and config version. Existing records must be `UNKNOWN_LEGACY`; do not infer type from `live/replay`. |
| Engine | Extract a deterministic Indicator decision from price-action factors; derive Analysis from technical trigger plus contextual Fusion and actual AI review/veto. Use independently versioned source configs, but share one hard-gate result. Neither stream can emit on a forming candle, with stale/delayed data, or when any common risk gate blocks. Preserve shared raw candle features where valid and store factor/feed/model provenance. |
| Persistence/events | Replace general writer use for official signals with one typed `createFromEngine(source, …)` transaction. Pair candidates for the same close/group, set agreement, insert each source row once, then publish. Keep tracker transitions/source metadata common. Do not notify on persistence failure. |
| Statistics/compare | Filter live verified `engine_live` separately from replay/legacy. Return source-specific summaries and an explicit Combined view only. Add group agreement/confluence and paired R comparison; sample counts and confidence intervals are required, with minimum-sample labels. Bootstrap intervals/random baseline/AI-value tests require a sufficiently large verified sample and must not be presented as measured before it exists. |
| Terminal/History | Render independent Indicator and Analysis lanes with WAIT/developing/OFFICIAL, source-specific score/rationale, shared block reasons, agreement state and clear AI-offline status. Add All/Indicator/Analysis/Confluence filters and partner links. History statistics must never silently combine source types. |
| Telegram/chart/journal/settings | Add source and agreement to signal/lifecycle notifications and markers; merge paired setup alerts. Link My Trades to source/group and detect double exposure. Configure per-source enable/threshold/cooldown/weights while retaining a shared risk stop. |

## Implementation status after audit

- Added `INDICATOR`, `ANALYSIS`, and `UNKNOWN_LEGACY` analytical-source types separately from lifecycle `origin`. SQLite migration preserves old origin provenance, marks old live/paper analytical source unknown, and leaves v1 hashes verifiable; v2 hashes include source/group/provenance fields.
- Added separate versioned `weights.indicator.json` and `weights.analysis.json`, per-source threshold/weight controls, and a runtime-validated Settings API. The common L1-L11 calculations still share the same technical and context feature code; source differences are configuration and gates, not independent implementations.
- Added one typed `createFromEngine(source, …)` writer and an atomic paired writer with unique per-source candle/config idempotency. `GET /snapshot` is now read-only; official creation is wired to the configured M5/M15 candle-close callback.
- Both candidates share feed connectivity/freshness/delay, divergence, price-action, score/grade, reward-risk/lock, recent severe-news, and active-shock gates. Analysis requests a fresh real AI review without the on-demand cache; offline mode either blocks or explicitly marks rule-fusion-only. AI cannot override common hard blocks.
- The shared live outcome tracker remains source-agnostic and handles both rows. Paired setup alerts are grouped and source-labelled; lifecycle Telegram messages include source/agreement. `signal_created` WebSocket delivery and reconnect initialization expose official rows.
- History now offers All/Indicator/Analysis/Confluence and defaults to `engine_live`; source comparison provides per-source summaries, one Indicator outcome per confluence group, agreement buckets, and paired mean R with an insufficient-sample gate. The compare API marks bootstrap CI unavailable rather than fabricating one.
- Settings expose per-source enable/threshold/cooldown/technical-confirmation/AI-offline controls and independent weight editing. DB repository and migration tests run on in-memory/temp databases.

## Remaining limitations

- The market provider's cross-asset correlation/macro baselines still contain hardcoded values; those inputs are not proven live in the existing project. The new Analysis lane records their factor/source labels but must not be treated as independent until those feeds are verified.
- There is no genuine calendar service, shared daily-R circuit breaker, per-source lock implementation beyond source cooldown plus the shared engine lock, or independent analysis engine module. Recent verified high-severity news and active shock are the current news blackout proxy.
- Paired bootstrap confidence intervals, random baseline, AI-value comparison, score calibration by source, and source-compare browser tests are not implemented. Current verified live samples are zero; all live metrics should remain `insufficient sample` until new engine-live outcomes accumulate.
- The Settings API has no authentication; do not expose it directly to an untrusted network. Existing project-wide authentication/rate limiting remains absent.
- This source upgrade did not execute the separately approval-gated fake purge. The production database is unchanged; the current dry-run still lists 10 synthetic replay rows for deletion and 3 test bundles for quarantine.

## Verification boundary

The audit confirms the existing architecture and coupling from code, but it does not claim independent source performance or real AI edge. There are no verified live signal samples in the audited database. A comparison, calibration, paired confidence interval, or random baseline will initially report insufficient sample; no statistical edge claim can be made until real source-tagged outcomes accrue.
