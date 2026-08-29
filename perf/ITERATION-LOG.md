# CodeBurn performance iteration log

Date | branch/PR | metric | before → after | verdict | mechanism
---|---|---|---|---|---
2026-08-29 | perf/harness-phase0 | harness (all) | n/a → pinned | kept | Phase 0 harness + synthetic fixture; no product change
2026-08-30 | perf/period-switch-cache-today | period-switch first 7D/30D | 120.9/166.3 → 62.8/64.3 ms | kept | complete daily-cache 7D/30D live-parse is today-only
2026-08-30 | perf/today-skip-history-backfill | cold-start-cli desktop/menubar p50 | 1651/1510 → 1375/1203 ms | kept | today-only status loads on-disk daily cache, skips 365d backfill
2026-08-30 | perf/today-mtime-floor-dated | cold-start-cli desktop/menubar p50 | 1171/1177 → 616/546 ms | kept | today-only first-paint mtime floor + fixture mtimes stamped from event timestamps; 2509 files → 81
2026-08-30 | perf/today-mtime-floor-dated extras | cold-start-cli honesty-gate | 554/556 → 562/556 ms (tsx, dated fixture) | kept (correctness) | rangeIncludesToday so --day/--from/--to keep full-range parse; omit 7D extras that would pretend today is the period; fingerprint skip reverted (wait-path still process-exit)
2026-08-30 | perf/cold-start-skip-optimize-first-paint | cold-start-cli desktop p50 | 567 → 504 ms (tsx, dated fixture; menubar 542 → 540 held) | kept | skip scanAndDetect while deferredForFirstPaint; optimize block empty until unfloored fill
2026-08-30 | perf/cold-start-skip-fingerprint-first-paint | cold-start-cli menubar p50 | 545 → 505 ms (tsx, dated fixture; desktop 501 → 502 held, already skips snapshot on optimize) | kept | skip computeCorpusFingerprint before first paint when no status-snapshot file exists; fingerprint after payload only if hydration is complete and a snapshot can be saved
2026-08-30 | perf/today-first-paint-snapshot | menubar today poll-2 | 479 → 436 ms (tsx, dated fixture; poll-2 byte-identical snapshot hit; HEAD had no snapshot files) | kept | persist today-only first-paint status snapshot; historical files deferred by the 48h floor are outside today; multi-day first paints stay unsaved
