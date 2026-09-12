## 1. The fix

- [x] 1.1 `App.tsx` `noteFramingChanged`: the two unknown-before-state exits re-derive the
      count after the write lands; `jobsEnded`'s doc names both moments
      *(landed 2026-09-11 as caa00be, ahead of this record)*
- [x] 1.2 Cells in `bulkJobSurfaces.test.tsx`: an orbit on a ready tile moves the count by
      one by hand (`models` not re-asked); an orbit on a tile that has not landed re-derives
      (`models` asked twice, "Reset 1 framings"). Falsified: drop `setHandDelta` → the first
      fails; restore the bare `return` → the second fails *(caa00be's report)*

## 2. Land it

- [x] 2.1 Suites and typecheck green on merged main *(client 945/945 at caa00be; 952/952 at
      b612de0 with the pose work on top)*
- [x] 2.2 `openspec validate unjudged-framing-recount --strict`; archive dry run on a fresh copy
      *(2026-09-11: valid; dry run on a fresh copy `~ 1`)*
