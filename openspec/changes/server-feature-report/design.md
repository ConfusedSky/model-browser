# Design — server-feature-report

## Context

The launcher is the precedent end to end: `launcher.report()` behind `GET /api/apps`
(ungated), injected into the app for tests, fetched once per session by `App`'s mount
effect (`refreshApps` — "once per session, and that is the whole schedule", L5), a
failed read yielding `null` and withheld surfaces. The demo will be an env-selected
mode of this repo served by the same build (`docs/web-demo-notes.md`, Defaults), so the
client must ask the server what is on rather than be compiled for a mode.

## Goals / Non-Goals

**Goals:**
- One place the client learns the server's capabilities; one place the server declares
  them; consumers gate surfaces with no mode conditionals anywhere.
- Byte-identical UI today: the default report changes nothing.

**Non-Goals:**
- Enforcement. The report is advisory, for shaping surfaces; refusing a write is the
  route's own job, owned by whatever change turns the capability off (1.3's read-only
  thumbs). A client that ignores the report loses UX, never gains access.
- Any consumer's gating (orbit routing, bulk-job surfaces, chat tab) — their changes.
- Runtime re-reads or push updates. The report is per-process configuration; a server
  restart is already the rule for config changes (`launch.json` precedent).

## Decisions

### D1: Capabilities, never a mode

The report says what the server does (`thumbWrites: boolean`, and later fields per
consumer), never "demo: true". The client cannot branch on a mode it never learns, so
every combination stays expressible and testable — the launcher's empty-report gating
is this rule already working. Field semantics are declarative ("thumb writes are
accepted"), so a field's owner is whoever makes it false, not this change.

### D2: Its own ungated route, not a rider on `/api/library`

`GET /api/features`, joining `UNGATED` beside `/api/library` and `/api/apps`: the
client needs the report while the library is unconfigured (the surfaces it shapes
exist in every state). Riding the `/api/library` envelope was weighed (zero extra
trips — the session's running theme) and declined: `library.state()` is dynamic
per-request state, the report is static per-process configuration, and mixing them
couples every state answer to config wiring. The cost is one ~100-byte GET per
session, the same price `/api/apps` already pays for the same reason.

### D3: Fetched once, held beside `apps`; unknown withholds, failure opens

`App` fetches it in a mount effect exactly as `refreshApps` does and holds it in
state; consumers read it from there (context extraction can come when a consumer
outside `App`'s tree needs it). The state is three-valued, and the middle value is
what kills the flash (Masa's round-trip question surfaced it, 2026-09-02): while the
report is **unknown** — in flight — gated surfaces are withheld, so a demo visitor
never sees write surfaces render and then vanish one transocean RTT later; locally
the withholding lasts one loopback round trip, invisible. A **failed** read resolves
to the everything-on default: the report only shapes surfaces, enforcement is
server-side (Non-Goals), so failing open is today's UI, while failing closed would
silently withhold local features — and silently reroute orbit persistence — on a
transient error. The asymmetry with `/api/apps` failing to `null`/withheld is
deliberate and worth stating: offering a launch into an app the registry cannot vouch
for acts on the user's machine; offering a surface whose write the server will refuse
merely earns an error the route already gives.

*Noted for 1.3, not taken here:* once the demo change makes Hono serve the client
shell, it may seed the report into the served HTML (an inline global read before
fetching) to erase the startup round trip entirely. That is serve-time machinery a
`bun run dev` session never exercises — Vite serves the shell locally and the fetch
path must exist regardless — so it belongs to the change that owns static serving,
as an optimization over a flash this decision has already removed.

### D4: Constructed at start, injected like the launcher

`index.ts` builds the report value (today: all-on constants) and hands it to the app
the way the launcher is handed in; tests inject variants. Read once at server start —
the restart-after-editing rule every config in this app follows. 1.3 replaces the
constants with its env selection without touching the mechanism.

## Risks / Trade-offs

- [A consumer treats the report as security] → the capability's spec states the
  advisory/enforcement boundary normatively; reviewers have a sentence to point at.
- [Report and enforcement drift — a server says `thumbWrites: true` while refusing
  writes] → the field's owner (1.3) must set both from one source; stated as a
  requirement so the pairing is testable there.
- [Fields accrete ad hoc] → each field lands via its owner's change with its meaning in
  this capability's spec; the report type lives in `shared/types.ts` where both sides
  compile against it.
