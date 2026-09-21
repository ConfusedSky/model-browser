## 1. The rule

- [x] 1.1 In `server/src/guard.ts`, replace the alternation in both `LOOPBACK_ORIGIN` and
      `LOOPBACK_HOST` with `(([a-z0-9-]+\.)*localhost|127\.0\.0\.1|\[::1\])`, keeping the
      anchors and the `(:\d+)?` tail, and add the `i` flag to both (D1, D3); verify
      `bun run typecheck` passes.
- [x] 1.2 Replace/extend the comment above the two constants with what a reader cannot rederive:
      that `.localhost` is reserved to loopback by RFC 6761 §6.3 and resolved there by browsers
      with no DNS lookup, and that the anchors are what keep `localhost.evil.com` out. No line
      numbers, no change history (repo `CLAUDE.md`).

## 2. Tests that pin the edges

- [x] 2.1 In `server/test/guard.test.ts`, under the unconfigured block, add a cell allowing a
      `.localhost` name that nothing configures — the issue's `evil.localhost`: `Host:
      evil.localhost:5173` with `Origin: http://evil.localhost:5173` answers 200 — and a
      nested-label case (`a.b.localhost`, allowed the same way); verify the cell passes with
      `cd server && bunx vitest run test/guard.test.ts`.
- [x] 2.2 In the same block, add the refusal cell: the issue's other two names,
      `localhost.evil.com` and `notlocalhost`, are each refused by `Host` (403 `forbidden host`)
      and, with a loopback `Host`, by `Origin` (`http://localhost.evil.com` → 403 `forbidden
      origin`). The block's header comment claims the unconfigured guard is byte-identical to
      what `api.test.ts` asserts, and that "a change that widens the unconfigured guard fails
      here" — which is already false for *this* widening: no cell in either file sends a
      `.localhost`-shaped host, so the widening passes both suites untouched. The new cells are
      what make the claim true again. Rewrite the header comment to say what the unconfigured
      guard allows rather than that it is unchanged, and rename the `describe` title with it —
      `"the unconfigured guard is exactly what it was"` carries the same byte-identical claim as
      the comment (e.g. `"the unconfigured guard allows loopback and nothing else"`).
- [x] 2.3 Add a case cell (D3), covering both regexes since the `i` flag goes on both: a
      `.localhost` name in mixed case is served by `Host` (`Host: Build-A.localhost:5173`, no
      `Origin`) **and** by `Origin` (a loopback `Host` with `Origin:
      http://Build-A.localhost:5173`). Falsify each flag separately — drop the `i` on
      `LOOPBACK_HOST` alone and see only the `Host` half go red, then restore it and drop the `i`
      on `LOOPBACK_ORIGIN` alone and see only the `Origin` half go red — before checking this off
      (`falsify the mutation too`).
- [x] 2.4 Leave `server/test/api.test.ts` alone: its `same-origin guard` block makes the same
      three requests (`evil.example` by `Origin`, `evil.example` by `Host`, loopback allowed) and
      nothing `.localhost`-shaped, so it restates the unconfigured rule rather than pinning this
      edge — the guard suite is where the new cells belong. Verify `cd server && bunx vitest run`
      is green across the whole server suite.

## 3. Preview

- [x] 3.1 Confirm by running `cd server && bunx vitest run test/preview.test.ts` that the
      existing cells pass unchanged (its loopback entry is `http://127.0.0.1:3177`, untouched).
- [x] 3.2 Add one preview cell pinning D2: `origins: ["http://x.localhost:5173"]` leaves no
      declared identity, so `og:url` is built from the request's own host; and a request whose
      `Host` is a `.localhost` name is described by the library rather than by the deployment.
      Verify it passes.

## 4. Docs

- [x] 4.1 Add one line to the repo's `CLAUDE.md`, in the `dev:remote` neighbourhood, saying a
      `*.localhost` dev name needs no `origins` entry (the guard treats the reserved TLD as
      loopback and Vite's `allowedHosts` already admits it by default), while a tailnet name
      still does — that is why `scripts/dev-remote.sh` writes a copy of the configuration.
- [x] 4.2 No `docs/platform-surface.md` row: this adds no OS-specific behaviour — no spawning,
      no per-OS path or directory, no display-server dependency. Check off once confirmed by
      reading the change's diff.

## 5. Gate

- [x] 5.1 `bun run typecheck` and `bun run test` both green from the repo root.
- [x] 5.2 `bun run format` (which runs Prettier twice — it is not idempotent here), then
      `bun run format:check` clean.
- [x] 5.3 Exercise it once for real: start the server with no `origins`, ask
      `curl -H 'Host: evil.localhost:5173' 'http://127.0.0.1:3177/api/dir?path=/'` and see a
      listing rather than `403 forbidden host`; record the library `top`/`id` the server logged
      beside the result. Result — `curl -H 'Host: evil.localhost:5173'
      'http://127.0.0.1:3177/api/dir?path=/'` answered 200 with the listing; library id
      `a32a1f7f-5947-4bd8-b808-08814c6370ad`, top
      `/home/masa/Documents/tests/test-models/miniatures/original/Locked_Chest_3040102`, server
      started from this worktree with `MODEL_BROWSER_CONFIG` pointing at an absent file (no
      origins), 2026-09-21.
