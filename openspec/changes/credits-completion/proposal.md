## Why

The demo has been public since 2026-09-09 and every kit on it is CC-BY. The lightbox
attribution block names the author, prints the license label as text and links the
source — but the license asks for two more things the site does not say anywhere: that
the served copies are modified (vertex-clustered display copies, some kits passed through
byte-identical), and a reference to the license itself, its URI where practicable. Both
were parked on the About page (`web-demo-backlog` 1.5, undrafted) and a credits page (1.8);
neither exists, and a site that is already live should not wait on either for its
compliance line. The lightbox is where each work is displayed, which is where the license
lets attribution be given, so the two missing facts go there — per kit, from the store.

## What Changes

- The corpus metadata gains two per-kit fields, written by `model-browser-corpus` (its own
  work, in flight beside this change): `license_url`, the exact license URI with its
  version, and `modified`, a short phrase saying what was done to the served copy — absent
  for a kit passed through unchanged.
- The override store's credits block gains the matching two fields, `licenseUrl` and
  `modified`, through every stage that names credit fields by name: the shared type, the
  generator's mapping, the loader's allow-list, and the resolver's field-wise inheritance
  (which already carries `credits` as one field, so nothing changes there).
- The lightbox attribution block links the license label to the stored URL when there is
  one, and draws a `modified` row when the store holds the phrase — the row is the
  modification notice, and it stands where the model is shown. Kits without the phrase draw
  no such row: attribution is displayed where it exists, never advertised as missing.
- `web-demo-backlog` gate 3.2 is reworded from "a credits page exists" to "attribution is
  complete in the lightbox", and 1.8 is downgraded to a courtesy that can ride the landing
  page; the notes' decided row says the same.
- Deployment: the regenerated store is rsynced to the box as the demo README already
  describes, and the app is restarted with it — the store is read once per library
  resolution, so a rewritten file under a running server is not seen until one. Shipping
  the store before the app is safe: the loader drops unknown credit fields silently, so the
  new fields sit on disk unread until the app that reads them lands.

Not in this change: a credits page or route, a feature flag, any grid change, and the
print warning at the Download action (`web-demo-backlog` 1.6 owns that action; it may key
on the `modified` field this change lands).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `library-overrides`: *A per-library override store* — credits hold two more string
  fields, license URL and modified; *Credits are generated from the corpus metadata* —
  the generator maps `license_url` and `modified` beside the four it maps today.
- `model-viewer`: *The panel credits the model's source* — the license is a link when a
  URL is stored, and a modified row draws when the phrase is stored.

## Impact

- `shared/types.ts` (`OverrideCredits`); `scripts/gen-overrides.ts` (`Kit`, `creditsOf`);
  `server/src/overrides.ts` (`loadOverrides`'s credit-field allow-list);
  `client/src/viewer/ViewerLayer.tsx` (the attribution rows).
- Tests: `server/test/genOverrides.test.ts` (fixture and mapping), `server/test/overrides.test.ts`
  (the allow-list cell "serves only the four credit fields" becomes six),
  `client/test/viewerCredits.test.tsx` (link and row cells).
- Wire: `/api/overrides` answers carry two optional strings more; no route added.
- Deploy: one rsync and one app restart on the box; `deploy/demo/README.md` §3.2 already
  names the file. Depends on the regenerated store from `model-browser-corpus` — the app
  change can land first with no visible effect.
- Records: `web-demo-backlog` tasks 1.8 and 3.2; `docs/web-demo-notes.md` decided row.
