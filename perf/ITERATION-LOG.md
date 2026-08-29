# CodeBurn performance iteration log

Date | branch/PR | metric | before → after | verdict | mechanism
---|---|---|---|---|---
2026-08-29 | perf/harness-phase0 | harness (all) | n/a → pinned | kept | Phase 0 harness + synthetic fixture; no product change
2026-08-30 | perf/period-switch-cache-today | period-switch first 7D/30D | 120.9/166.3 → 62.8/64.3 ms | kept | complete daily-cache 7D/30D live-parse is today-only
2026-08-30 | perf/today-skip-history-backfill | cold-start-cli desktop/menubar p50 | 1651/1510 → 1375/1203 ms | kept | today-only status loads on-disk daily cache, skips 365d backfill
