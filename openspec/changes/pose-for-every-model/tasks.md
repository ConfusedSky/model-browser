# Tasks — pose-for-every-model

> Ordering: after the archived AO sequence (uses its labels and reconciler). Coordinate
> with `library-overrides` (drafted): its pose field is the future override — whichever
> change lands second wires the precedence (stored camera > store pose > index pose >
> default) and records it in both. **Before any demo bake.** Cross-repo: §1 lands in
> `~/Documents/tests/mini-classify` under that repo's conventions.

## 1. mini-classify: the poses call

- [ ] 1.1 `POST /poses` — `{ paths: [...] }` → `{ poses: { <path>: pose | null } }`, a pure
      pose-cache lookup; 503 while warming like `/query`; bounded request size, refusing
      an oversized batch in the surface's own error shape
- [ ] 1.2 `docs/api/surface.md` gains the call beside the other four, with the "no GPU, no
      lock" statement and why (store lookup)
- [ ] 1.3 Tests per that repo's conventions; if anything is measured, an eval script and a
      learnings entry per its CLAUDE.md

## 2. Server: the proxy and the peek ranking

- [ ] 2.1 `server/src/semantic.ts`: `posesForDir(library, dirPath)` — list the directory's
      models, ask `/poses`, map real paths → library paths with per-path confinement
      (`hitsToEntries`' rules); absent/warming/uncovered index → empty, never an error
- [ ] 2.2 `app.ts`: `GET /api/semantic/poses?path=<dir>` (gated like other path routes;
      404/400 semantics per the path rules); wire types in `shared/types.ts`
- [ ] 2.3 The peek (`app.ts` peek handler): walk to four *posed* finds within the existing
      entry bound, unposed finds as ordered fallback; one `/poses` batch per peek over the
      finds; index silent → exactly today's selection (assert byte-identical order)
- [ ] 2.4 Server tests: proxy mapping + confinement + index-down; peek pose-priority, the
      fallback fill, the bound unchanged, index-down order identical; falsify the ranking

## 3. Client: the second wave

- [ ] 3.1 `api/client.ts`: `semanticPoses(dirPath)`; `App.tsx`: after a plain listing lands,
      fetch and merge into the `poses` state the reducer already holds (meaning/similar
      landings keep their riding poses; no double fetch); latest-listing-wins, stale waves
      dropped like stale listings
- [ ] 3.2 Client tests: a wave over a displayed grid re-renders only unposed-drawn tiles,
      images kept (the reconciler cells' shape); index down → no requests loop, no state
      churn; a wave landing after navigation is dropped; falsify the merge
- [ ] 3.3 The lightbox: `pose={poses[...]}` now resolves on plain listings too — assert the
      handoff parity cell still holds with a wave-supplied pose

## 4. Verification

- [ ] 4.1 `bun run test` / `bun run typecheck` both repos' suites; `openspec validate`;
      ordered archive dry run
- [ ] 4.2 Live: a plain listing of unowned models stands them up within one queue pass,
      images kept meanwhile; contact sheets over a mixed folder show posed models first;
      index stopped → listings and peeks behave exactly as today
- [ ] 4.3 `web-demo-backlog` 1.2 marked drafted→applied; the bake-ordering note stays until
      the demo change lands
