# Tasks — server-feature-report

> Ordering: independent of every active change; lands whenever. Consumers gate in their
> own changes afterwards: `bulk-thumbnail-jobs` (its surfaces), `web-demo-backlog` 1.3
> (env-driven values, chat tab, and the 2.1 orbit routing). Mechanism-only: with the
> default report, every wire answer and every pixel is byte-identical to today.

## 1. Server

- [ ] 1.1 The report type in `shared/types.ts` (`thumbWrites: boolean` to start) and a
      constructed value in `index.ts` handed into `createApp` the way the launcher is —
      injectable; today's construction is all-on constants, replaced by 1.3's env
      selection later (design D4)
- [ ] 1.2 `GET /api/features` in `app.ts` answering it, added to `UNGATED` beside
      `/api/library` and `/api/apps` (design D2)
- [ ] 1.3 Server tests: answers all-on by default; answers an injected variant;
      answers while unconfigured (the UNGATED cell — `/api/apps` has the precedent)

## 2. Client

- [ ] 2.1 `ApiClient.features()` (`jsonOrThrow`, like `apps()`); `App` fetches it in a
      mount effect and holds `FeatureReport | null` — null (in flight or failed)
      withholds gated surfaces; an unresolved report is retried on each
      navigation — an effect keyed on the view path mirroring the index-availability
      effect's trigger, no poll, no timer — until it resolves (design D3). Cite D3's
      offer/behavior split where consumers will look
- [ ] 2.2 Client tests: harness gains a `features` mock defaulting to a known all-on
      report (every pre-existing test unchanged — the byte-identity requirement's
      cell); a gated surface is absent while the report is unresolved and never
      flashes (drive with a hanging mock); a failed read leaves it absent and the
      next landing retries; the request goes through `ApiClient`

## 3. Verification

- [ ] 3.1 `bun run test` / `bun run typecheck` clean from the workspace dirs
- [ ] 3.2 Live: `/api/features` answers all-on on the dev instance, answers while
      unconfigured (`MODEL_BROWSER_ROOT` unset), and the app renders identically with
      the route stubbed to fail
