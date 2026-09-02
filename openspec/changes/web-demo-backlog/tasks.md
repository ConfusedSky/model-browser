# Tasks — web-demo-backlog

> A tracking change: no code, no spec deltas. A line is done when it names the change
> it became, or the notes' item carries the decision and its date, or the gate is met.
> `openspec validate` refuses a change with no deltas — expected here, not a defect; the
> archive dry-run with `--skip-specs` passes (2026-08-29). Archive that way once every line is done. Ownership: this session — the
> other session (pose-for-every-model, web-demo-deployment) closed 2026-08-29.

## 1. Changes to draft (in this order, after the drafted main-app sequence)

- [x] 1.1 *(drafted 2026-08-31 as `library-overrides` — proposal, design, specs, tasks
      complete; ADD-only `model-viewer` delta beside the three active AO changes)*
      `library-overrides` — the per-library override/metadata store (notes item 1,
      decided shape in design D2): credits per kit, display names, a pose field; the
      lightbox credits panel that reads it; generation of the demo's entries from
      `metadata/miniatures.json`. Hard ordering: after `library-root` (keys are library
      paths, the file lives beside the marker)
- [x] 1.2 *(drafted and applied 2026-08-31 as `pose-for-every-model` — three workers: the
      mini-classify `/poses` call (`f074334` there), the server proxy + posed-first peek, and
      the client wave; extended 2026-09-01 with the index-first peek (`/under`, `3dde233`
      there) after the walk budget starved structural sheets; live-verified (12/12 sheet,
      byte-identical dead-index fallback, 24 healed sibling pairs) and archived 2026-09-01
      as `2026-09-01-pose-for-every-model` — proposal, design, two deltas
      (listing-wide pose supply; contact sheets prefer posed models, Masa's 2026-08-31 ask),
      tasks incl. the cross-repo `/poses` endpoint; validates and archive-dry-runs clean;
      the line below is the original)* pose-for-every-model — was the other session's; now owned here. Every tile is
      posed from the index (or the store's pose field) whether or not a search carried a
      pose — today `wantsPose = poses[path] !== undefined` gates it. Must land before any
      bake, or the bake produces un-posed tiles corpus-wide (verified in the notes).
      Reconcile with `ao-refreshes-thumbnails` §2b's `poseStale` rule, which it will
      exercise on every model
- [ ] 1.3 the demo mode — the split itself (notes' "Not drafted" paragraph and Defaults):
      env-selected mode, public-origin guard replacing the loopback body of *API
      restricted to the app's own origin*, read-only thumbs, launcher off, chat tab
      hidden, static serving, the bake, the credits page. Needs 2.1–2.4 decided first

## 2. Decisions to record in `docs/web-demo-notes.md` (answer + date on the item)

- [x] 2.1 Visitor orbits (item 3): with `PUT /api/thumb` refused, persist a visitor's
      drag in their own localStorage, or freeze curated framings? Notes' default:
      frozen; a persisted orbit is a global edit
      — **localStorage** (Masa, 2026-09-01, recorded on the item the same day):
      per-visitor persistence edits nothing shared, so the frozen default's
      global-edit objection does not apply; baked thumbnails stay the curated
      framings. Mechanism lands in 1.3
- [x] 2.2 Landing (item 4): kit tiles with contact sheets alone, or also a sentence for a
      recruiter — banner, About beside credits, or nothing
      — **a landing page exists** (Masa, 2026-09-01, recorded on the item the same
      day): not the bare grid alone. Contents (banner vs About, copy, the flat-view
      sub-question) deliberately deferred — 1.3 carries them as an open design
      question, not a blocker
- [x] 2.3 Names (item 5): rename folders at corpus build (re-embed) or display names from
      the store (near-free once 1.1 exists; ids stay in paths)
      — **display names from the store** (Masa, 2026-08-31, recorded on the item the same
      day). 1.1's draft carries `name` as a generated field already; the consumer is a
      follow-up to `library-overrides`
- [ ] 2.4 Domain (item 6): on the critical path for TLS and the configured-origin guard —
      1.3 cannot name its allowed origin without it
- [x] 2.5 Ownership (item 7): this session owns the demo proposal and
      pose-for-every-model — Masa, 2026-08-29, the other session closed. Recorded on the
      item the same day

## 3. Go-live gates (corpus side, not app work)

- [ ] 3.1 IP pass by eye over the corpus (one Monster Hunter dragon known)
- [ ] 3.2 Credits page generated from `metadata/miniatures.json` (CC-BY requires displayed
      attribution) — the generator is 1.1's; the gate is the page existing for the
      shipped corpus
- [ ] 3.3 One paid hour on the actual instance for the query-latency number (the CPU fp32
      figure is from this machine; the notes' Measurements say where to re-run it)
