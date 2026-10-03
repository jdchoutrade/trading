# Cleanup and Data Integrity Changelog

## 2026-10-01 - Audit and verified pre-cleanup backup

- Replaced unsupported claims in `DATA_AUDIT.md` with findings from source inspection and read-only SQLite queries.
- Classified 10 formula-generated replay signals and 3 SQLite immutability-test signals as non-production data. Their 32 linked events and 13 outcomes were reconciled; no orphan events were found.
- Recorded current UI responsiveness gaps and identified synthetic feed/intelligence fallbacks and request-driven signal ingestion.
- Added `npm run backup:verify`. It uses SQLite's online backup API, checks integrity/schema/table contents, restores to a temporary database, and compares the restored contents.
- Backup verified: `backups/pre-cleanup-2026-10-01T09-52-00-914Z.sqlite`.
- Source, backup, and restored logical database fingerprint: `61596a527fd09b19696b2dbebb50e839d00a39238881b00bdb7ca962d4c60955`.
- No database rows were deleted or modified. No rows were quarantined. Permanent cleanup remains blocked pending explicit user approval after dry-run.
- Added `npm run cleanup:demo -- --dry-run`, which selects only replay rows with the historical-replay source/tags and test rows with `source_feed='TEST'` plus the test fixture prices. It requires the current database fingerprint to match the latest pre-cleanup backup; rows linked to notes or journal trades are preserved as suspect.
- Dry-run result: 10 replay signals + 3 test signals; 32 linked events + 13 outcomes; 0 linked notes/trades; 0 suspect rows. No database changes were made.

## Pending

- Await explicit user approval before invoking `npm run cleanup:demo -- --confirm`.
- After approval, remove only the confirmed test/replay groups transactionally and verify linked-row counts.
- Replace request-driven signal persistence with closed-candle live ingestion and enforce provenance/idempotency.
- Implement mobile history cards/navigation/chart behavior, PWA, offline/reconnect status, and viewport tests.
- Run and report actual Playwright and Lighthouse results; neither has been run in this audit stage.
