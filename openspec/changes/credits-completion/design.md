## Context

A credit reaches the screen through five stages that each name the credit fields
explicitly: `OverrideCredits` in `shared/types.ts`; the generator's `creditsOf` in
`scripts/gen-overrides.ts`, which maps the corpus metadata's snake-case fields; the
loader's allow-list in `loadOverrides` (`server/src/overrides.ts`), which serves exactly the
named string fields and leaves anything else on disk unread — `library-overrides` D1's
answer to a hand-written store field reaching React as a child; `resolveOverrides`, which
inherits `credits` as one field down the key prefix and so needs nothing; and the
lightbox's attribution rows in `ViewerLayer.tsx`, one row per field the store holds.

The live store on the box holds 288 kits with author, author URL, license and source URL.
The license label is Thingiverse's, "Creative Commons - Attribution", printed as text; the
served kits are vertex-clustered display copies and nothing on the site says so. Both
facts are what CC-BY asks for beside the author's name (`web-demo-notes` and
`web-demo-backlog` parked them on the About page and a credits page, neither drafted).
The corpus side (`model-browser-corpus`) is adding two per-kit metadata fields for them:
`license_url`, the license URI with its version, taken from the thing page; and
`modified`, a short phrase for what was done to the served copy, absent for kits passed
through byte-identical. This change is the app side of those two fields.

Constraints: `/api/overrides` answers are consumed only by the lightbox; the store file is
read once per library resolution (`createOverrideHolder`), so a rewritten file under a
running server is not seen until a restart; the loader drops unknown credit fields
silently, which is what lets the store ship before the app.

## Goals / Non-Goals

**Goals:**
- Carry `licenseUrl` and `modified` from the metadata to the lightbox through every stage
  that names credit fields, with a cell per stage.
- Link the license label to its URL; draw the modified phrase as a row of the attribution
  block, only where the store holds one.
- Land the regenerated store on the live box and restart the app with it.
- Reword gate 3.2 to what the license actually needs.

**Non-Goals:**
- A credits page or route (`web-demo-backlog` 1.8, now a courtesy that can ride the
  landing page), a feature flag, any grid or tile change.
- The print warning at the Download action (`web-demo-backlog` 1.6 owns that action; it
  may key on `modified`).
- Normalising the license label (`CC BY 4.0`) or deriving the version in the app — the
  corpus is the source of truth for both and the URL carries the version.
- Inferring modification from triangle counts or file sizes in the metadata.

## Decisions

### D1: Two named fields through the allow-list, not a passthrough

The loader's allow-list stays an allow-list and grows by two names. The alternative — pass
every string field of `credits` through — would reopen the hole D1 of `library-overrides`
closed: a store is hand-editable, and a field nobody named would reach a renderer that
iterates the block. Naming the fields costs one line per stage and buys the property the
deploy order relies on: a store carrying fields this build does not know is served as if
they were absent, silently. The spec now says so, since the deploy plan leans on it;
wrong-typed *known* fields keep reporting, as they do today.

### D2: `modified` is a phrase, absent means unchanged

A string the corpus writes ("decimated for display"), not a boolean and not a free-text
`notes` field. A boolean would leave the wording to the app, which does not know what was
done — some kits are passed through byte-identical, and which ones is a corpus fact. A
generic notes field would hold the same phrase but the app could not tell a modification
notice from any other remark, and `web-demo-backlog` 1.6 wants to warn at Download only for
altered copies. The row draws the phrase verbatim under the label `modified`; the app adds
no wording of its own, so the corpus can say "decimated for display" today and something
more specific later without an app change. Absent means unchanged and draws nothing: the
block's rule that attribution is displayed where it exists and never advertised as
missing extends to not labelling an unchanged copy.

### D3: The license label links; it is not replaced

The label stays the corpus's string and becomes a link when a URL is stored, like the
author. Replacing the label with a normalised short form in the generator was
considered: it reads better, but it makes the generator decide what the license *is* from a
label Thingiverse chose, and a wrong guess is a wrong license notice. The URL is what
carries the version, the thing page is where the corpus takes it from, and the label is
what that page says. A kit with a label and no URL draws as it does today.

### D4: Row order — author, license, source, modified

The modified row is last. The three existing rows say whose work this is and where it came
from; the fourth says what was done to this copy, which reads as a footnote to them. It
uses the block's existing row shape (`data-credit` attribute, `dt`/`dd` pair, right-aligned
value) so the tests can address it the way they address the others.

### D5: The generator reports the two counts

The run report gains "with license URL: n, modified: n" beside the written/read counts. The
corpus and the app agree on field names by convention, not by a shared type, so a rename
on either side would otherwise produce a store that is silently thinner — every key
written, none carrying the new fields. Two zeros in the report is the check.

### D6: Deploy order is free; the restart is not

The store may land before or after the app: before, the loader ignores the two fields
(D1); after, the app draws nothing new until the file arrives. What is not free is the
re-read — `createOverrideHolder` reads the file once per library resolution — so the
regenerated store on the box needs an app restart, which the redeploy for the app image
performs anyway. Tasks order the rsync before the `up --build` for that reason, and the
verification reads `/api/overrides` on the live host for a kit known to be modified.

## Risks / Trade-offs

- [The corpus spells a field differently] → D5's counts read zero on the run; the task
  that regenerates the store gates on both being non-zero.
- [A kit's `modified` phrase is long] → the row is a `dd` with `break-words`, like the
  license; a phrase is expected to be a few words, and the corpus owns the wording.
- [A license URL with no version, or a wrong one] → the app links what it is given; the
  corpus takes it from the thing page, and the spec makes the app infer nothing. The
  label beside it still names the license family.
- [The lightbox is the only place the notice appears] → the grid shows renders with
  attribution a click away, which the license's "reasonable manner" allows; the credits
  page that would cover the grid in one place stays a courtesy (1.8).
- [The store ships and the fields do not appear] → the holder's once-per-resolution read;
  D6's restart, and the live verification reads the wire, not the file.

## Migration Plan

1. Land the app change (types, generator, loader, lightbox, tests) — no visible effect
   until the store carries the fields.
2. When `model-browser-corpus` has written `license_url` and `modified`, regenerate the
   store on the corpus with the generator and check D5's counts.
3. rsync the store to the box as `deploy/demo/README.md` §3.2 describes; redeploy
   (`git pull && docker compose -f deploy/demo/compose.yaml up -d --build`), which restarts
   the app.
4. Verify on the live host: `/api/overrides?path=<a modified kit>` carries both fields;
   the lightbox shows the linked license and the modified row.

Rollback: the previous store is a file; putting it back and restarting the app restores
the four-field block. The app change is additive and needs no rollback of its own.

## Open Questions

- None for the app. The two metadata field names (`license_url`, `modified`) were settled
  with Masa on 2026-09-09; the phrase wording is the corpus's.
