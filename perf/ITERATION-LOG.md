# CodeBurn performance iteration log

Date | branch/PR | metric | before → after | verdict | mechanism
---|---|---|---|---|---
2026-08-29 | perf/harness-phase0 | harness (all) | n/a → pinned | kept | Phase 0 harness + synthetic fixture; no product change
2026-08-30 | perf/period-switch-cache-today | period-switch first 7D/30D | 120.9/166.3 → 62.8/64.3 ms | kept | complete daily-cache 7D/30D live-parse is today-only
