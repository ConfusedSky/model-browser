# Tasks — server-feature-report

> Ordering: independent of every active change; lands whenever. Consumers gate in their
> own changes afterwards: `bulk-thumbnail-jobs` (its surfaces), `web-demo-backlog` 1.3
> (env-driven values, chat tab, and the 2.1 orbit routing). Mechanism-only: with the
> default report, every wire answer and every pixel is byte-identical to today.

## 1. Server

- [ ] 1.1 The report type in `shared/types.ts` (`thumbWrites: boolean` to start) and a
      constructed value in `index.ts` handed into `makeApp` the way the launcher is —
      injectable; today's construction is all-on constants, replaced by 1.3's env
      selection later (design D4)
- [ ] 1.2 `GET /api/features` in `app.ts` answering it, added to `UNGATED` beside
      `/api/library` and `/api/apps` (design D2)
- [ ] 1.3 Server tests: answers all-on by default; answers an injected variant;
      answers while unconfigured (the UNGATED cell — `/api/apps` has the precedent)

## 2. Client

- [ ] 2.1 `ApiClient.features()` (`jsonOrThrow`, like `apps()`); `App` fetches it in a
      mount effect on the `refreshApps` shape and holds it as three-valued state —
      unknown while in flight (gated surfaces withheld), all-on on failure (design
      D3 — the deliberate asymmetry with apps-to-null is in the design, cite it at
      the call site)
- [ ] 2.2 Client tests: harness gains a `features` mock defaulting to all-on (every
      pre-existing test unchanged — the byte-identity requirement's cell); a failed
      read renders identically to all-on; a gated surface is absent while the report
      is unresolved and never flashes (drive with a hanging mock); the request goes
      through `ApiClient`

## 3. Verification

- [ ] 3.1 `bun run test` / `bun run typecheck` clean from the workspace dirs
- [ ] 3.2 Live: `/api/features` answers all-on on the dev instance, answers while
      unconfigured (`MODEL_BROWSER_ROOT` unset), and the app renders identically with
      the route stubbed to fail
