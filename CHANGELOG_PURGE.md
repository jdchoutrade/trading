# Fake-Signal Purge Changelog

## 2026-10-01 - Evidence audit and purge preparation

- Added `FAKE_AUDIT.md` before new purge/code changes. It traces signal writers, test/replay sources, current Terminal actions, and all persisted signal/event/outcome classes with file/line evidence.
- Verified the three screenshot rows in SQLite: `source_feed='TEST'`, identical fixed levels, one-minute creation cadence, TP3 outcomes, and `150.89R` MFE. The MFE follows from the outcome tracker processing a quote at 4158.88 against the test entry/risk; it is not a hardcoded value.
- Classified 10 formula-generated replay rows as `DEMO_CONFIRMED`. No replay run metadata or real historical input exists, so none qualify for `REPLAY_LEGIT` or migration to `replay_results`.
- Classified the three test signal parents as test fixtures; their nine later tick transitions and three outcomes are `SUSPECT` and will be copied to quarantine, not discarded. Their three initial insert events are included in the archive bundle.
- Updated `npm run backup:verify` to create `backups/pre-purge-<timestamp>.sqlite` through SQLite's online backup API and verify restore integrity/schema/content.
- Added `npm run purge:fake -- --dry-run` and `--confirm`. The dry-run requires an exact logical fingerprint match to the latest pre-purge backup. Confirmation archives suspect bundles into `quarantine_signals` and deletes only matching generated replay/test signal groups. It aborts if any signal is unclassified or the signal table is not fully covered by the reviewed candidate set.
- Removed the prior `cleanup:demo` command/script because it could delete candidate rows without quarantining suspect event/outcome evidence.
- Latest backup verified: `backups/pre-purge-2026-10-01T11-35-39-202Z.sqlite`; source/backup/restore fingerprint `61596a527fd09b19696b2dbebb50e839d00a39238881b00bdb7ca962d4c60955`.
- Dry-run: 10 confirmed replay signals + 20 events + 10 outcomes scheduled for deletion; 3 suspect test bundles + 12 events + 3 outcomes scheduled for quarantine; 0 real-verified, replay-legit, unclassified, or journal-linked rows. No database rows or schema were modified.
- **Approval gate:** Do not invoke `npm run purge:fake -- --confirm` until the user approves the exact preview.

## Not yet implemented

- Purge/quarantine execution, replay/live separation in History, single closed-candle official signal pipeline, durable idempotency, and parity verification.
- MFE/MAE invariants and “I Took This” visibility rules.
- Production grep guard and isolation of tests from the real DB.
- Unit/integration tests for the purge classifier and quarantine transaction.
