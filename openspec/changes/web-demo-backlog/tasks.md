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
- [x] 1.3 the demo mode — **applied and archived 2026-09-07 as `public-deployment`** (the config file, the configured-origin guard, the five fields with refusal at the routes, the local-framing decorator, the withheld chat tab, the host withholding, the served client; the landing page, context-menu actions, bake and credits stay 1.5–1.8). The split itself (notes' "Not drafted" paragraph and Defaults):
      a separately-configured deployment, public-origin guard replacing the loopback body
      of *API restricted to the app's own origin*, read-only thumbs, launcher off, chat tab
      hidden, static serving, the bake, the credits page. 2.1–2.4 are all decided, and four
      shape decisions were taken 2026-09-02 (Masa) and recorded in the notes: its own
      config in the existing `config.json` rather than `MODEL_BROWSER_ROOT` (which
      `library-root` made an ordinary local setting — the 2026-08-28 default was stale;
      no third file, and the never-recorded `config.json`/`launch.json` split is now
      justified in the notes), one capability field per surface, each with its own default and
      the built-in set being the supported/tested configuration rather than merely the
      initial one (chat off — see the `tabStore` fallback it breaks), preview paths on dir entries as
      the bake shape, and `models.masamaeda.com`.
      **Drafted 2026-09-02 as `public-deployment`** (commits `abe4fc3`, `5dd6096`,
      `bd6b982`: two review rounds applied), which is the first of what is now six changes
      — the others are 1.4–1.8 below. The host was decided 2026-09-07 (Masa: the CX23
      gate 3.3 ran on, as it is; upgrade later if visitors feel it — notes, Decided
      table); the origin/CDN choice stays open as a design question, not a blocker. The landing page's
      contents, open here at drafting, were decided 2026-09-03 (notes item 4, line 1.5)

- [x] 1.4 the deployment's own infrastructure — reverse proxy, TLS, the container
      definition, and how `deploy/demo/config.json` reaches the box (Masa, 2026-09-03: its
      own ticket, separable from `public-deployment` and **writable and testable earlier**,
      since it depends on nothing in the app). Not the app's configuration, which
      `public-deployment` owns. **Drafted 2026-09-07 as `demo-infrastructure`**: one shared
      network namespace behind Caddy, images built on the box from pinned bases, state in
      volumes, the config file bind-mounted from the checkout, a `local` profile to
      rehearse here first. **Applied 2026-09-08 and deployed 2026-09-09 — archived**:
      https://models.masamaeda.com is up on the CX23 behind Caddy with a Let's Encrypt
      certificate, every runbook check passing from outside; the thumbnails are **not yet
      baked** (1.7), so until then every visitor renders every tile in their own browser
      and nothing persists. `deploy/demo/config.json` was written in full by
      `public-deployment`
- [ ] 1.5 the landing page — contents **decided 2026-09-03** (Masa; recorded on notes item 4
      the same day): a slim banner over the grid — one sentence, query chips that run on
      click, About and credits links — dismissed once per browser via localStorage; a full
      About page carrying license/provenance, corpus alterations and the print warning,
      the desktop-vs-demo differences, a five-line how-to, links, privacy, and a technical
      section including posing, and a Limitations section of verified examples (Masa,
      2026-09-05: under-represented concepts return the least-far neighbour, not
      nothing; neighbouring concepts blur — vampires/zombies/skeletons as undead; a
      two-part query matches part by part — "an elf carrying an orb" brings elves and
      orb-holders beside the elves with orbs, the fuller matches usually scoring
      higher, added 2026-09-07). Root
      opens as kit tiles (Masa, 2026-09-03). The
      banner also carries a source link (repo is public); the how-to names Ctrl+F alone
      (it replaces browser find) and About notes Shift+right-click for the browser menu;
      the chips get a bake-time test asserting each still returns a hit. Ready to draft
- [ ] 1.6 the context-menu actions — Download replacing Open-in/Open-with, Copy path
      becoming Copy link. `native-context-menu-bypass` **archived 2026-09-03** (`e41a06a`)
      having MODIFIED *A context menu on grid tiles* — no ordering to declare, but rederive
      against the applied spec rather than against what that requirement said before.
      Carries the print warning: downloads are decimated display copies, print from the
      source — at the Download action itself, not only on the About page (notes item 4)
- [ ] 1.7 the corpus bake — preview paths attached to dir entries (the decided shape);
      rides `listing-tree-cache` and `bulk-thumbnail-jobs`
- [ ] 1.8 the credits page — go-live gate 3.2, and **standing alone** rather than riding
      the landing page (Masa, 2026-09-03): CC-BY attribution should not wait on that
      change's copy decisions. The generator exists from `library-overrides`, so this is a
      route and a rendering. Closes gate 3.2 when it lands
- [ ] 1.9 hover-warmed listings — drafted 2026-09-03 as `hover-prefetch-listings`,
      **unparked 2026-09-08** when 1.3 landed: folder and zip tiles warm their listing
      after the mesh warm's linger, so a click spends no round trip. Client only, no
      server change; its tasks §1 still gates the build on a before/after measurement,
      because against localhost (5–8 ms a listing) the change is invisible — and it must
      be taken against the real origin, not the SSH tunnel. The thumbnail half split out
      the same day as `hover-prefetch-thumbnails`, gated on that measurement and on the
      CDN question: HTTP/2 and an edge cache may leave it worth nothing

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
      sub-question) were deferred at the time and **decided 2026-09-03** — recorded on
      item 4 and line 1.5, not carried by 1.3
- [x] 2.3 Names (item 5): rename folders at corpus build (re-embed) or display names from
      the store (near-free once 1.1 exists; ids stay in paths)
      — **display names from the store** (Masa, 2026-08-31, recorded on the item the same
      day). 1.1's draft carries `name` as a generated field already; the consumer is a
      follow-up to `library-overrides`
- [x] 2.4 Domain (item 6): on the critical path for TLS and the configured-origin guard —
      1.3 cannot name its allowed origin without it
      — **`masamaeda.com`** (Masa, 2026-09-02, recorded on the item the same day
      with the live TXT-record proof of control). Expires 2026-11-12; **auto-renew
      confirmed by Masa 2026-09-03**, so the caveat this line carried is closed and
      the decision is unconditional. Hostname settled as `models.masamaeda.com`
      (Masa, 2026-09-02), which is `public-deployment`'s configured origin
- [x] 2.5 Ownership (item 7): this session owns the demo proposal and
      pose-for-every-model — Masa, 2026-08-29, the other session closed. Recorded on the
      item the same day

## 3. Go-live gates (corpus side, not app work)

- [ ] 3.1 IP pass by eye over the corpus (one Monster Hunter dragon known)
- [ ] 3.2 Credits page generated from `metadata/miniatures.json` (CC-BY requires displayed
      attribution) — the generator is 1.1's; the gate is the page existing for the
      shipped corpus
- [x] 3.3 One paid hour on the actual instance for the query-latency number — **run
      2026-09-04 on a Hetzner CX23** (notes, Measurements: 1.23 s median, over the 1 s bar
      by ~23%; `docs/hetzner-probe-runbook.md`, `scripts/query-probe.py`) and **the host
      decided on it 2026-09-07** (Masa: launch as it is, upgrade if needed)
