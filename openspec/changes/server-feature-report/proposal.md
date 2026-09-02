# Server Feature Report

## Why

The demo split (`web-demo-backlog` 1.3), visitor-orbit routing (decision 2.1:
localStorage when the server refuses thumb writes), and `bulk-thumbnail-jobs`' surfaces
all need the client to know what this server *does* — without the client ever learning a
mode name, and without forking the build. The launcher already solved this shape once:
`openInApps` builds from the `/api/apps` report and an empty report withholds the launch
surfaces with zero client-side conditionals. This change generalizes that pattern into
one capability report, settled in `docs/web-demo-notes.md` (2026-09-02): resolved via
`ApiClient` — one client build serves both modes; `import.meta.env` would fork it.

## What Changes

- A **feature report** the server serves: what this server accepts and offers, starting
  with one field — `thumbWrites` (whether `PUT /api/thumb` is accepted). Constructed
  once at server start and injectable like the launcher; today's value is
  everything-on, and the demo change flips fields via its env selection.
- The client fetches it at mount and resolves it into one place the UI reads. Gated
  surfaces are **withheld until a known report opens them** — in flight and failed
  reads alike, retried per listing landing until resolved — so nothing flashes and
  nothing opens on error. The report shapes *surfaces*, never security: enforcement
  always lives server-side with whatever turns a capability off, and a behavior with
  an existing default changes only on an explicitly declared value, never on a failed
  read (design D3's offer/behavior split).
- No consumer behavior changes in this change: with the report at its default, every
  surface renders byte-identically to today. Consumers (orbit routing, bulk-job
  surfaces, chat-tab hiding) gate on it in their own changes.

## Capabilities

### New Capabilities

- `feature-report`: what the report is, how it reaches the client, the fail-closed
  withholding with retry-until-resolved, and the report-is-advisory /
  enforcement-is-server-side boundary (with D3's offer/behavior split).

### Modified Capabilities

None. Consumers modify their own capabilities when they adopt the report.

## Impact

- `server/src/index.ts` / `app.ts`: a features value constructed at start, one ungated
  route (joining `/api/library` and `/api/apps` in the `UNGATED` set — the client needs
  the report in every library state).
- `shared/types.ts`: the report type (additive).
- `client/src/api/client.ts`: one method; `App` (or `main.tsx` context) holds it from a
  mount effect, the `refreshApps` shape.
- Known consumers, none in this change: `web-demo-backlog` 1.3 (env-driven values,
  chat tab), `bulk-thumbnail-jobs` (its `library` tab and menu entries),
  the 2.1 orbit routing. Each adds its own fields/gating; this change is the mechanism.
- Collision check (re-run 2026-09-02 after review): no active change touches the
  report's files beyond additive type edits. `listing-tree-cache` 6.6 does add a
  reload endpoint — a different route, no overlap, named so this claim stays honest.
