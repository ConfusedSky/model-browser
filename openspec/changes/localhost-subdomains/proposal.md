## Why

`server/src/guard.ts` treats only the bare name `localhost` as loopback, so an API request
arriving with `Host: build-a.localhost:5173` is answered `403 forbidden host`. RFC 6761 §6.3
reserves the whole `.localhost` TLD and browsers implement it: Chrome and Firefox resolve any
`*.localhost` name to loopback with no DNS lookup and no hosts-file entry (Safari defers to the
macOS resolver and is not verified here), so
`build-a.localhost` is this machine exactly as much as `localhost` is. That name is the natural
way to run several dev builds side by side behind one reverse proxy — a subdomain per branch or
worktree, no ports to allocate — and today each one has to be added to `origins`, which means
either editing the tracked configuration per branch or generating a copy the way
`scripts/dev-remote.sh` does for a tailnet name. A tailnet name genuinely needs that ceremony
because it is routable and machine-specific; a `.localhost` name is neither, so it buys nothing.
GitHub issue #49.

## What Changes

- Widen the guard's two loopback patterns (`LOOPBACK_ORIGIN`, `LOOPBACK_HOST` in
  `server/src/guard.ts`) to admit any label sequence under `.localhost`, anchored so the name
  must *end* at `localhost`. `127.0.0.1` and `[::1]` are untouched.
- Match the host case-insensitively, so a browser sending `Build-A.localhost` is treated as the
  `build-a.localhost` it names — the allowlist compare in `isAllowedHost` already ignores case.
- Pin the anchoring with guard tests: `evil.localhost` allowed by `Host` and by `Origin`, the
  nested `a.b.localhost` allowed too, `localhost.evil.com` and `notlocalhost` refused.
- Record in the repo's `CLAUDE.md` that a `*.localhost` dev name needs no `origins` entry.
- Not changed: `LOOPBACK_HOSTS` in `server/src/config.ts`, which validates `listen.host` — a
  bind address, a different concern (see design D4). No new configuration key, no new route, no
  client change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `directory-browsing`: the requirement *API restricted to the app's own origin* — what counts as
  loopback, which its scenario *An unconfigured server is loopback-only* pins as "the loopback
  origins and hosts it allows today". That set grows by the `.localhost` TLD, and two new scenarios
  pin the growth and where it stops.

`public-deployment`'s requirement *The entry document carries link-preview metadata* says the
metadata describes the library for "the host it declares for itself, or loopback" and needs **no**
delta: it names loopback without enumerating it, and `directory-browsing` is where that set is
defined. The observable consequence for previews is real, and is design D2 rather than a
requirement change.

## Impact

- `server/src/guard.ts` — the two patterns and the comment above them.
- `server/src/preview.ts` — no edit, but `createDescribe`'s `configured` (computed once in the
  factory, skipping loopback entries to find the declared identity) and the returned `describe`'s
  `isAllowedHost` gate both move with the widened rule;
  design D2 states which way and why that is wanted.
- `server/test/guard.test.ts` — new cells; `server/test/preview.test.ts` — one cell pinning D2
  (tasks 3.2).
- `CLAUDE.md` — one line on the dev workflow this unblocks.
- No OS-specific surface: no spawning, no per-OS path, no display-server dependency, so
  `docs/platform-surface.md` is unaffected.
