# Web demo — exploration notes (2026-08-28)

The record of an `/opsx:explore` session on hosting a public demo of model-browser
over the CC-BY corpus, **before any change exists**. Nothing here is normative:
when a change is proposed, its proposal/design/specs supersede this file and it
should point at them. A second session explored in parallel and sent a briefing;
where the two differ it is noted, and everything it claimed about the code was
verified against source before being kept.

Corpus: `~/Documents/tests/test-models` (its own repo, `ConfusedSky/model-browser-corpus`;
read its `NOTES.md` — measured findings on GLB vs STL, dedup, decimation, open
items). 297 kits, 2,254 shipped models in `miniatures/clustered-hq/` (1.8 GB,
0.84 MB/model, largest file 5.9 MB), all Thingiverse, **297/297 CC-BY** (no PD in
the shipped set), no zips. Provenance per kit in `metadata/miniatures.json`
(`name`, `author`, `author_url`, `source_url`, `license`, per-file `sha256`) —
**gitignored, exists only on that disk.** Index: mini-classify `embed-cache-test`,
2,165 models = 2,254 − ~89 `NON_MODEL_TAGS` drops (consistent, not confirmed by
count), root `miniatures/deduplicated/`.

Audience: recruiters viewing a portfolio (from the other session). First
impression and the link never being dead outrank everything else.

## Drafted (2026-08-28) — these supersede the items they cover

The pre-split main-app sequence exists as OpenSpec changes, each validated and
archive-dry-run **in this order** on one fresh copy (hard orderings are declared in
each tasks.md; several deltas stack on the same requirements and only apply in
sequence):

1. `library-root` — **archived 2026-08-30** (`openspec/changes/archive/2026-08-30-library-root`;
   the capability is `openspec/specs/library/`) — item 2, decided form: library identity +
   marker, `/` = library top, confinement, per-library cache under XDG, one-time re-key
2. `remove-axis-lighting` — **archived 2026-08-31** — item 9
3. `ao-as-recipe-dimension` — **archived 2026-08-31** — item 8's two-render cache (sibling file, no migration)
4. `ao-refreshes-thumbnails` — **archived 2026-08-31** — the re-targeted `lighting-refreshes-thumbnails` (directory
   renamed with `git mv`; §2b kept, §2 rewritten in review into a ref-held incremental reconciler)
5. `adaptive-ao-default` — item 8's frame sampling (lightbox-measured, three-state
   preference, budget tune-then-freeze) — **deferred 2026-08-31**: `ao-default-off`
   (applied the same day) flips the static default to off instead (Masa: shipping
   outranks adapting; cheap now that thumbnails follow the preference, which is what
   retired option (a)'s handoff objection). Re-derive before applying
6. `folder-contact-sheets` — **archived 2026-08-31** — the decided row; per-tile bounded peek, zips excluded

Not drafted — tracked as the change `web-demo-backlog` (2026-08-29, one task line each):
the override store / credits (item 1), pose-for-every-model (was the other session's),
the demo split itself (confinement is now free; guard, read-only thumbs, launcher off,
chat tab hidden, static serving, bake, credits page), the decisions in items 3–6, and the
go-live gates below.

7. `public-deployment` — **drafted 2026-09-02** — the first of the six changes the demo
   split became (`web-demo-backlog` 1.3–1.8). **Its proposal, design and specs supersede
   this file's Defaults section and items 3, 8 and 9's demo halves**, per the rule at the
   top of this file: the deployment's configuration, the configured-origin guard, the five
   capability fields and their refusals, the visitor's localStorage orbit, the withheld
   chat tab, and the serving of the built client are settled there, with the reasoning and
   the alternatives weighed. Read that change, not this section, before proposing anything
   in its area. The five still-undrafted splits are backlog 1.4–1.8: the deployment's own
   infrastructure, the landing page, the context-menu actions, the corpus bake, and the
   credits page.

## The inversion at the center

Every security decision in the repo rests on one premise (`guard.ts`,
directory-browsing spec "API restricted to the app's own origin"): *the server
reads and serves arbitrary local paths as the user*. Hence loopback-only bind,
refuse non-loopback `Host`, never emit CORS, absolute paths in `/api/dir`,
`/api/file`, `/api/thumb`, and in URLs. A public demo inverts all of it: the
server must accept a public `Host`, and an absolute-path API on a public box is
path traversal by design. The demo needs a **root-confined address space**, not
"the app minus some features". The guard's spec *title* already says "the app's
own origin"; only its body hardcodes loopback.

## Decided

| decision | by | note |
|---|---|---|
| Port the server (container/VM), don't bake to static | corpus NOTES + both sessions | bake was weighed: D1's `ApiClient` seam would host a static client, `similar` is image×image dot products the browser could do, but text→embedding needs the SigLIP text tower (hundreds of MB) — one endpoint at minimum |
| Always-on VM, not cold-start serverless | Masa | 16 s SigLIP load + `wedged` UI is the wrong first impression |
| CPU-only index, fp32, US-located, 4–8 GB | Masa | see Measurements; GPU warmed is tens of ms, CPU 0.3–0.6 s judged acceptable (<1 s). **US-located relaxed 2026-09-02 (Masa): EU origins back in consideration pending a visitor-latency benchmark** — and therefore round-trip count is a first-class 1.3 design concern; see the EU paragraph in Measurements |
| Folder tiles get a 2×2 contact sheet — **a main-app change, before the split** (applied 2026-08-31: `folder-contact-sheets`, including the D3 no-reset assertions and the live checks once `ao-refreshes-thumbnails` landed the same day; every task closed, cold-media numbers in its tasks.md 3.4) | Masa | `Grid.tsx` draws sheets from `GET /api/peek` per visible tile, inside amber folder chrome; verified live on the clustered-hq root — 297 folders, 12 peeks on first paint, 10 more per scroll screen, AO toggle re-renders cells with no reset |
| Credits/provenance shown in the lightbox info panel | Masa | plus a generated credits page for CC-BY |
| ~~Lighting menu hidden in demo mode~~ → **axis lighting mode removed from the main app; camera is the only mode; the pill goes** (implemented: `remove-axis-lighting`, applied 2026-08-31 — row closed) | Masa | the hide was only ever to stop visitors picking axis. Item 9 has the grounding (every sidecar says `camera`, 0 `axis` — 1,758 at this session's count, 1,792 at later reviewers' runs the same day; axis's motivating bug has no counterpart in camera mode) |
| **SSAO stays a user option** (pill kept), default chosen adaptively by sampling frames; both AO variants baked for the demo | Masa | item 8 has the design: AO becomes a thumbnail recipe dimension, cache keyed by recipe |
| **`ao-refreshes-thumbnails` (formerly `lighting-refreshes-thumbnails`) is re-targeted, not retired**: its trigger becomes the AO pill | Masa | the mechanism — a toggle re-runs the staleness sweep in place, tiles keep their image while the replacement renders (§2, rewritten in review as a per-entry reconciler), the `poseStale` rule stated and asserted (§2b — the bug it named was already fixed in `28289d1`) — carries over; on the demo the sweep finds the other baked variant, so toggling is instant. Prerequisite: AO as a recipe dimension (item 8). Rename/`opsx:update` the change rather than start a new one |
| Chat **tab** hidden in demo mode | Masa | the side panel keeps its search-options tab |
| app-launch dies (`/api/apps`, `/api/open`, `/api/open-with`, launch.json) | all | `openInApps` builds from the `/api/apps` report and `Open with…` gates on `ctx.apps?.chooser` — an injected empty-report launcher withholds both with zero client code (verified) |
| GLB conversion deferred | other session, agreed | touches mini-classify `COVERS`, re-embedding, client loader; wire cost is fine |

## Open — need Masa's call

1. **Override/metadata store.** Three consumers: credits (per kit), display names
   (`name` vs `stem` with thing id), and poses-for-every-model (other session
   wants a server-local pose sidecar keyed by rel path — same store, third
   field). Sidecar JSON in the folder (travels with the kit; matters because the
   real library is on removable media) vs sqlite (`node:sqlite` only — D1;
   Bun compat unverified). Deciding question: *display only, or search by it?*
   Display → sidecars. Search → sqlite as a rebuildable index over sidecars.
   Note the thumb-cache sidecar is already a per-path store for camera/axis but
   is bounded and **evicts** — provenance cannot live there.
   **Resolved by item 2's `.model-browser/` decision (Masa: all per-library
   data in one folder at the library top, no noise in subdirectories):** one
   `overrides.json` there, keyed by library-relative path, directory keys
   applying to their subtree (longest prefix), files overriding; loaded at
   start, written atomically (temp + rename); poses (other session) are a
   field in it; the demo's credits are generated into it from
   `miniatures.json`. "Search by author" is trivial in memory once loaded, so
   sqlite only if a library outgrows load-at-start — it won't at hundreds of
   kits. Price accepted: a kit copied out of the library carries no metadata.
   **Implemented 2026-08-31 as `library-overrides`** (store + resolution +
   `/api/overrides` + display names on tiles + the lightbox credits block +
   the generator; the demo store is generated — 288 kits, see its tasks 3.3).
2. **Path model — decided: a library root as a first-class parameter, paths
   root-relative everywhere** *(implemented as `library-root`, 2026-08-29; the change's
   design supersedes this item)* (Masa; Electron later repoints it with a file
   dialog). Not a demo mode: it fixes remount orphaning locally — thumb cache
   key is `sha256(absolute path)` and the sidecar stores that path, so a moved
   mount point orphans every thumbnail *and camera*; `listing-tree-cache`
   keys on the root path and admits the same ("wasteful, correct"). Deep
   links become portable. `hitsToEntries` already ignores the index's absolute
   path and resolves `collection_root + rel_path` "so as not to undo D4's
   remount reasoning" — the app's own paths catch up. Design points: root from
   `~/.config/model-browser/config.json` (`launch.json` precedent) with
   `MODEL_BROWSER_ROOT` overriding, **required** (no root → a clear message,
   not an empty grid); root missing at start is a *state* (removable media),
   the `volume-gone` shape mini-classify reports; confinement =
   `realpath(root/path)` under `realpath(root)`, symlinks escaping the library
   rejected, one rule for local and demo; **migration**: re-key the cache
   once from each sidecar's stored absolute path
   (`sha256(relative(root, meta.path))`) so cameras survive — mini-classify's
   `migrate_cache_keys.py` is the precedent; recents/last-path just reset.
   One root, repointable — multiple named libraries deferred. Blast radius:
   five `isAbsolute` sites (`listing.ts`, `app.ts`; `/api/thumb` validates nothing today), `vpath.ts`,
   `/api/complete`, `urlState` `path`/`model`, recents, the cache key, the
   index-root → app-relative mapping; specs: directory-browsing (path bar,
   autocomplete, recents), url-navigation, zip-browsing, model-thumbnails
   (D4), semantic-search. Hard ordering against `listing-tree-cache`,
   `search-cancellation`, `thumbnail-sweep-priority`. Diverges from the other
   session's `library-root-confinement` ("absent = unchanged", absolute
   paths): root always required, paths always relative is the version to
   carry.
   **Masa's objections, later the same day, both accepted:** (i) re-rooting
   from `/a/b/c` to `/a/b/c/d` shifts every relative path — cache orphaned,
   deep links broken — bad for Electron where the root is picked freely;
   (ii) two libraries with the same layout (`/a/b/c` vs `/d/b/c`) collide on
   relative keys — PNGs mostly survive via `path + mtime` (exposed case:
   same relpath, same mtime, different content; copies preserve mtime), but
   **cameras are keyed by path alone (D4, for re-exports) and would leak and
   write back across libraries.** A relative path is a name, not an identity.
   **Revised model — library ≠ root.** A *library* is identity + cache
   namespace + deep-link base, marked by `<library>/.model-browser/
   library.json { id }` at its top; a *root* is merely where the app opens —
   any folder inside a library. Cache key = `hash(libraryId + path relative
   to the library top)`: remount anywhere hits; identical layouts never
   collide. Picking a subfolder walks up to the marker, keys stay relative to
   the library top, the app opens at the pick — nothing invalidates, deep
   links survive. A pick with no marker above it becomes a new library (marker
   written; the corpus build writes the demo's). Converges with item 1: the
   marker is the top-level instance of the per-folder sidecar family. Edges
   noted, not solved: picking *above* an existing library (refuse and offer
   the inner one, or migrate by prefixing keys); read-only media (id
   remembered in `config.json` against the volume — degrades to today);
   a library copied wholesale shares an id and content, so the cache is
   correct for both. The cheaper partial — key PNGs on `relpath + size +
   mtime`, no marker — fixes most pixel collisions and no camera ones; not
   sufficient alone.
   **Masa, then: all `.model-browser` data lives in that one folder at the
   library top.** Grounded: listings already skip dot-entries (`listing.ts`
   `startsWith('.')` guards, both walks), `ThumbCache` takes its dir as a
   constructor arg, and `listing-tree-cache`'s design inherits that dir and
   its eviction sweep. Layout: `library.json` (id, the marker),
   `overrides.json` (item 1), `thumbs/` (the bounded cache, **inside the
   library** — location becomes the namespace: remount or another machine
   brings thumbnails and cameras along; the id matters only for the fallback),
   `tree/` (the active change's snapshots, relocated). Fallback for read-only
   or unwanted-write volumes: XDG cache namespaced by the id (today's shape).
   Demo: the bake ships inside the corpus tree, read-only. **Measure before
   committing:** cache writes happen per render and per orbit release, and
   the removable library is the exFAT volume measured 15× slower on cold
   reads — if writes are worse, XDG becomes a per-library config choice, not
   just a read-only fallback. Ordering: `listing-tree-cache`'s design names
   `~/.cache/model-browser`; same code path pointed elsewhere, but its
   design.md must say so — hard ordering. Real library not mounted at the
   time of writing; store not sized against it.
   **Masa, weighing `<library>/.model-browser/` against
   `~/.cache/model-browser/<library>/`:** XDG fixes read-only, keeps the
   library clean, and keeps writes off the spinning drive; but does not
   travel. Comparison (this session): in-library travels (thumbnails *and*
   cameras — XDG strands cameras per machine, D4's stranding one level up),
   needs a fallback path, writes every render/orbit release onto exFAT with
   no journal (temp+rename weaker), churns sync/backup tools, and a
   git-managed library must gitignore part of it; XDG is one code path on
   SSD but must **name the library without writing to it** (marker anyway —
   not fully clean; or volume id + mount-relative path — platform-specific;
   or absolute path — today, breaks on remount), accumulates orphan dirs by
   id, isolates machines sharing one network library. **The split hiding in
   it:** derived/large/hot (PNGs, tree snapshots — regenerable, wants SSD,
   excluded from backups) vs authored/small/rare (identity, credits, names,
   poses, and arguably camera/axis — a user's choice, in the thumb sidecar
   only by convenience; the corpus's credits *should* be committed with it).
   Leaning: **hybrid** — `<library>/.model-browser/{library.json,
   overrides.json}` in-library; `~/.cache/model-browser/<id>/{thumbs,tree}`
   in XDG; cache-in-library as a per-library opt-in for a drive that should
   carry its thumbnails. Sub-question: camera/axis into `overrides.json` so
   orientations travel — then orbit releases rewrite a small file on the
   library volume; needs a debounce and the exFAT write measurement first.
   **Decided (Masa): the hybrid split.**
   **exFAT write measurement (this session, 2026-08-28, scratchpad
   `write_probe.py`, 100 writes each, median/p90):** on `/dev/sda2` — a
   3.6 TB *spinning* USB exFAT volume ("Files and S…", STLs under `3d/`;
   same medium class as the library, not confirmed to be it) — 100 KB PNG
   0.14/0.16 ms, 300 KB temp+rename 0.31/0.33 ms, 300 B temp+rename
   0.09/0.10 ms; **with fsync ~40/~50 ms regardless of size** (seek + flush).
   SSD (`~/.cache`): 0.04–0.11 ms, 0.5 ms with fsync. `ThumbCache` writes with
   plain `writeFile` — no fsync, no rename — so today's writes are the
   sub-millisecond rows: **write cost is not a reason to keep anything off
   the drive**; the split stands on read-only, cleanliness, backup churn and
   journal-less durability. Camera/axis in `overrides.json` is feasible and a
   durability *improvement* over today's unprotected sidecars if written
   temp + rename + fsync, debounced (40 ms per flush every few seconds of
   orbiting). exFAT unplug mid-write can tear a file — acceptable for a
   regenerable PNG, not for saved orientations. Not yet decided where
   camera/axis land; the measurement no longer blocks it.
3. **Visitor orbits.** With `PUT /api/thumb` rejected, persist a visitor's
   drag-to-orbit in *their* localStorage, or freeze curated framings?
   **Resolved 2026-09-01 (Masa): persist in the visitor's localStorage** —
   against the notes' frozen default. Consistent with the Defaults section's
   reasoning, which only ruled out *server-side* persistence (an anonymous
   `PUT` is a global edit under D4); a localStorage camera is per-visitor and
   per-browser, edits nothing shared, and the baked thumbnails stay the
   curated framings. The demo-mode change (backlog 1.3) owns the mechanism —
   camera reads fall back localStorage → baked sidecar, writes go to
   localStorage where the main app would `PUT`.
4. **Landing.** Kit tiles with contact sheets — is that the whole first screen,
   or also a sentence for a recruiter (what this is, what to try) — banner,
   About link beside credits, or nothing? (Sheets exist as of 2026-08-31 —
   `folder-contact-sheets`, applied — so the tiles half is real;
   whether the root should open in flat view instead of, or as well as, sheets
   is still its own question, unclosed by that change.)
   **Resolved in principle 2026-09-01 (Masa): there is a landing page** — the
   first screen is not the bare tile grid alone. Its contents (banner vs About
   beside credits, the copy, the flat-view question above) are deliberately
   deferred; the demo-mode change (backlog 1.3) carries them as an open design
   question and does not block on them structurally. **Contents resolved 2026-09-03 (Masa, converging with the other
   session's suggestion): a slim banner over the grid, not a page before it** — one
   sentence saying what this is, plus example-query chips that *run* the query on click
   (each verified against the live index before it becomes copy), an About link and the
   credits link. **Dismissed once per browser** (localStorage, the visitor-orbit
   precedent), with About reachable from a persistent spot afterwards. Everything else
   goes on the About page: license and provenance (CC-BY, not Masa's models, per-model
   attribution in the lightbox); how the corpus was altered (dedup, non-model drops,
   vertex-clustering decimation with small meshes passed through byte-identical, display
   names from the store) and that downloads are display copies — print from the source;
   what differs from the desktop app (the `public-deployment` list: Download replaces
   Open-in/Open-with, Copy path is Copy link, chat tab withheld, thumbnails baked and
   read-only, orbits saved per browser, host details hidden); a five-line how-to (drag a
   tile to orbit, Enter/Space opens, Ctrl-F narrows by name, Escape closes, Shift-F10 or
   the menu key for tile actions, the AO toggle); links (source, corpus repo, contact,
   credits, where to report a problem); a privacy line (no accounts, localStorage only);
   a WebGL/desktop note; and a **technical section** for the recruiter audience — stack,
   semantic search, and **posing** (Masa: harder than getting search right; invisible
   when it works). The posing blurb describes mini-classify's three tiers as its
   write-ups record them: flat-base geometry with a best/runner-up confidence ratio,
   then a SigLIP ensemble scoring six rendered candidate-up tiles against text prompts
   alongside the geometry vote, then a vision-language arbiter for the hard ~20% only;
   the front view chosen by front/back prompts in the same embedding space; the pose
   stored as data so listings, contact sheets and search all apply it and an orbit
   overrides without discarding it. **No accuracy figure** — the 2026-08-12 write-up
   there says in bold not to quote the tuned number, the holdout is 21 models, and a
   figure would have to be re-run before publishing. The print warning also belongs at
   the Download action itself (1.6), not on About alone. **Root opens as kit tiles** (Masa, 2026-09-03): the
   contact-sheet listing, not flat view — the chips already give the model-first flat
   grid on click, since a search result is one, so the two views keep different jobs.
   The change is backlog 1.5; nothing in item 4 is open.
   **Relayed from another session 2026-09-03 and verified against the code before being
   kept** (the one claim that did not hold is noted last): (i) **Ctrl+F is the one
   keybinding the copy must mention** — the app binds Ctrl/Cmd+F on window keydown to the
   narrow-by-name bar (except while typing in a query or path field), so a visitor's
   find-in-page becomes the app's find; Masa: Escape, Enter and Space are what everyone
   expects and need no line, Shift+F10 is accessibility, Tab lives inside the lightbox.
   (ii) **Shift+right-click** is left to the browser's own menu (`nativeMenuRequested`,
   `client/src/lib/gesture.ts`); on the web build the app's menu offers only Download and
   Copy link, so the bypass earns a line on About. (iii) **The repo is public**
   (`ConfusedSky/model-browser`, confirmed with `gh repo view`) — a source link sits on
   the banner itself beside About and credits, the strongest single item for the
   audience. (iv) **Chips carry a bake-time test**: each chip query must return at least
   one hit against the deployed index or the bake fails — a dead chip is the worst first
   impression; a 1.5 task, not copy. (v) Banner-plus-About, not a dismissible splash —
   already the shape above. **Not kept: "warm the index on page load."** mini-classify
   loads SigLIP once at process start and stays resident (its `docs/api/surface.md`); on
   the decided always-on VM the ~16 s lands at deploy, never on a visitor, and `App.tsx`
   already re-reads index status on mount and every 2 s while warming, so a restart
   under a visitor recovers without a reload. Nothing to add.
5. **Names.** Rename folders at corpus build (re-embed — needed anyway) or
   display-name from the store (near-free if #1 is sidecars; ids stay in paths).
   **Resolved 2026-08-31 (Masa): display names from the store.** Near-free now
   that `library-overrides` is drafted with `name` a field from day one — the
   generator already writes it from `miniatures.json`, ids stay in paths, and
   no re-embed is forced. The consumer (tiles and the panel rendering the
   stored name where one resolves) is a small follow-up to `library-overrides`,
   whose Non-Goals deferred exactly this until the call was made.
6. **Domain.** On the critical path for TLS and the configured-origin guard.
   **Resolved 2026-09-02 (Masa): `masamaeda.com`** — control proven live the
   same day (Masa added TXT `_demo-test.masamaeda.com` = "model-browser
   2026-09-02" from the Namecheap dashboard; it answered from the authoritative
   `registrar-servers.com` nameservers and Google's public resolver within
   minutes; record deletable once read). Registration: Namecheap since
   2019-11-12, expires 2026-11-12 — **auto-renew confirmed by Masa 2026-09-03, so
   this decision now carries no caveat.** (The confirmation is a Namecheap dashboard
   fact: Masa's word, not something a session can verify from here.) **Hostname decided 2026-09-02 (Masa):
   `models.masamaeda.com`** — the subdomain this row called the easy path. The
   apex stays bare; the only records today are a stale `www` CNAME to a dead
   Netlify site (cert mismatch, 404) that can be cleaned up whenever. This is
   the origin 1.3's guard is configured with.
7. **Which session owns the proposal.** **Resolved 2026-08-29 (Masa): this session
   — the other session closed; it also owned pose-for-every-model, now this
   session's too. The ordered tail is `web-demo-backlog` §1.** Other session's sequence
   was:
   pose-for-every-model → library-root-confinement → web-demo-deployment. This
   session adds: library-root (item 2, supersedes its confinement change),
   remove-axis-lighting, AO-as-recipe-dimension + re-targeted refresh change,
   adaptive AO default, folder contact sheets, credits + store, chat tab hidden. One
   ordered set, with hard ordering against the four in-flight changes
   (`listing-tree-cache`, `search-cancellation`, `thumbnail-sweep-priority`,
   `ao-refreshes-thumbnails`) — the first and third overlap directly
   (a baked tree is the tree cache's limit case; the bake is a sweep).

8. **Ambient occlusion on weak GPUs** (raised by Masa). On the demo thumbnails
   are baked, so AO costs a visitor only in the live view — but the orbit
   overlay opens over an AO thumbnail, so AO-off makes every touched tile change
   shading at handoff (the "Handoff stays seamless" scenario, suspended).
   `getRenderer` already asks `powerPreference: 'high-performance'` (works on
   Windows/macOS dual-GPU; Linux ignores it — where the 17 → 56 fps figure was
   measured, Radeon 780M, supersampled lightbox). "Is it a dGPU" is the wrong
   axis (Apple M-series integrated and fast; a GTX 1050 discrete and not;
   Firefox/Safari mask `WEBGL_debug_renderer_info`). Options: (a) demo-only
   `aoDefault: off` in the features value — one line, pays the handoff jump
   everywhere; (b) **main-app change, preferred**: AO on, measure the first
   clean live frames (orbit suspends the queue; skip warm-up frames), flip the
   existing `aoToggle` preference off when the median exceeds a budget, with
   the stored value three-state (unset/auto, user-on, user-off) so a choice is
   never overridden; pill stays (Masa confirmed: SSAO remains a user option). Budget is tune-then-freeze; the lightbox is
   heavier than the overlay, so budget the heavier surface. The AO output
   scale is a gentler first step than disabling (viewer-ssao design).
   **Masa, later the same day:** agreed on sampling frames; proposed two
   pre-rendered caches (AO on / AO off) so the adaptive default keeps the
   handoff seamless, noting cost may be model-dependent and the decimated
   corpus may make it moot. Grounded: GTAO's cost is per-pixel (AO + denoise,
   supersampled lightbox) plus a per-triangle pre-pass that is trivial at this
   corpus's tri counts (median 15k, p90 32k, max 117k — `miniatures.json`),
   so decimation does not shrink the cost, canvas size does; the population
   that trips it on a portfolio link is **phones**. Unmeasured: one
   `clustered-hq` kit in the iGPU browser, lightbox, pill on/off — do this
   first. Model-dependence is weak on the demo and real locally (million-tri
   STLs) — sample *continuously* (running median; flip off when exceeded; only
   the user flips back on), not once on the first model opened. The cache
   cannot hold two variants today: key is `sha256(path)`, `lighting`/`rig`/
   `posed` are echoed and gated client-side. Design that falls out: **AO
   becomes a thumbnail recipe dimension like lighting** (thumbnails follow the
   preference; the "always with occlusion" clause is rewritten) and **the
   cache key includes the recipe variant** — drafted as `ao-as-recipe-dimension`
   (two-render sibling cache, no migration; being implemented 2026-08-31) —
   locally, switching keeps the
   other variant (instant switch-back, LRU-bounded); on the demo, bake both
   AO variants (the deployment change's sweep runs once per preference) at one lighting mode (~270 MB each at the observed ~120 KB/PNG;
   1,705 cached here = 205 MB). Keyed-by-recipe would also allow the lighting
   menu to stay visible on the demo if all four variants were baked (~1.1 GB)
   — moot if item 9 removes the lighting pill. Hard ordering: after
   `ao-refreshes-thumbnails` (same files, same pattern). No
   `RIG_VERSION` bump — each recipe is unchanged; the set grows.

9. **Remove the axis/camera lighting pill from the main app** — **decided (B), remove axis mode; implemented as `remove-axis-lighting`, applied 2026-08-31** (Masa: "camera almost always looks better"; the demo hide was only to keep visitors off axis). Grounded: of 1,758 thumbnail sidecars
   in `~/.cache/model-browser`, **every one says `camera`, 0 say `axis`** (1,758 at this session's count; 1,792 at the second reviewer's run the same day) — this
   machine has run camera mode throughout — while `lighting.ts` has
   `DEFAULT_MODE = 'axis'`, so every fresh profile (every demo visitor) gets
   the other mode. Axis mode's motivating bug (world-fixed +Y rig lighting
   ±X/±Z-spindle models from the side, `axis-aware-lighting`) has no
   counterpart in camera mode, so dropping it loses nothing. Consequences:
   `ao-refreshes-thumbnails` (active, 0/22) exists only because the pill
   does — **re-target it to the AO pill** (Masa): §1's trigger changes, §2 and
   the §2b `poseStale` fix (orbited + posed models re-render and re-PUT on every
   meaning-grid visit; read-verified, not run) carry over unchanged. Cache
   `lighting` label stays (it is what makes a leftover `axis` PNG stale); no
   `RIG_VERSION` bump. With one lighting mode the AO recipe set in item 8 is
   exactly two variants, and the demo's "hide the lighting menu" row is moot.
   Chosen: (B) **remove axis mode** — spindle-frame rig orientation in
   `renderer.ts`, the tween slerp in `session.ts`, the pill, `LIGHTING_MODES`,
   spec requirement rewritten camera-only ((A), flipping the default and
   keeping axis reachable, was the two-line alternative). Main app, before the
   split; lands before the re-targeted refresh change.

## Defaults this session would take unless told otherwise

- Download replaces Open-in/Open-with; Copy path becomes Copy link.
- Demo is a **separately-configured deployment of this repo**, not a fork.
  **Both halves of the 2026-08-28 default are now stale and superseded (Masa,
  2026-09-02):**
  - the *selector* was `MODEL_BROWSER_ROOT` set ⇒ demo, written two days before
    `library-root` landed. That variable is now read by `configuredRoot` as one
    of the two ordinary ways to configure **any** local run — `bun run dev` sets
    it — so it cannot select anything. **Decided (Masa, 2026-09-02): the
    existing `config.json`, not a new file and not `.env`.** Capability fields,
    the guard's allowed origin and the bind address join `root` there, read once
    at start, `MODEL_BROWSER_CONFIG` already overriding the path so a container
    mounts its own. Interaction to remember: `configuredRoot` returns early when
    `MODEL_BROWSER_ROOT` is set, so that variable overrides the `root` key
    *without* skipping the file — today the early return means the file is never
    parsed at all, and with flags in it the file is always read.
    **Why not a third file, and why the two that exist are two:** asked by Masa,
    and there is **no recorded justification** for the `config.json`/
    `launch.json` split. `open-in-slicer` (archived 2026-08-27) introduced
    `launch.json`; `library-root` D4 introduced `config.json` citing "the
    `launch.json` precedent, `loadLaunchConfig`"; `server-feature-report` D4
    cites it again — all three for the *loading mechanism* (XDG config home, env
    override, read-once), never for the file being separate. `launch.json`
    appears in no spec at all. The split is accretion. It is defensible after the
    fact — a hand-authored argv-template DSL naming the machine's installed apps,
    normally absent, and the one config the demo never has — but that argues for
    `launch.json` staying separate, not for the flags becoming a third file: the
    demo needs `root`, the flags and the origin to be *coherent*, two files let a
    container mount half of it, and a third file is a third instance of the
    restart-after-editing gotcha. The rule this settles on, recorded because it
    was not: a separate file is for a different **authoring** concern (templates
    a user writes by hand, normally absent); the same file is for what describes
    **this deployment** — which library, what it accepts, where it is reachable.
  - the *client* half named a `features` value resolved in `main.tsx` via
    `ApiClient` **or** `import.meta.env`. `server-feature-report` (archived
    2026-09-02) settled this: the report is fetched through `ApiClient` and held
    in `App.tsx`, never a build-time value, and never names a mode.
- **Capability fields are one per surface** (Masa, 2026-09-02), not one coarse
  demo flag: thumbnail writes (the one field that exists today), the launcher,
  the chat tab, the bulk-job surfaces, and the semantic states a visitor can do
  nothing about. Each is a capability a server can state truthfully on its own,
  which is what keeps the report from becoming a mode name by another spelling.
- **The built-in defaults are the supported configuration** (Masa, 2026-09-02),
  and each field carries its own default rather than every field defaulting on.
  *No flags set* is not "the empty configuration" — it is **the maintained set,
  and its audience is the eventual distributed Electron app** (D1's seam): what
  someone who installs this app gets. Authoring flags is the exceptional path.
  **Narrowed the same day, after a first statement that overshot:** exceptional
  does not mean untested. The demo's own config is **checked into the repo**, not
  hand-authored on the box, and 1.3 tests that combination as a second named
  configuration — so the public deployment cannot drift from what CI proves, and
  "you are on your own" applies to arbitrary user-authored combinations only.
  Three consequences beyond the field values: the constant is named for what it is (`ALL_FEATURES` is now simply
  wrong — it is the *supported* set, not every capability on); the suite covers
  that set as its primary configuration and the demo's as the one named second,
  with any other combination exercised only by the change that owns the field,
  which is what bounds the combinatorial accretion `server-feature-report`'s own
  risks list flagged; and
  all-on stops describing anything anyone runs, so the spec's *Everything on
  changes nothing* scenario is no longer a picture of the shipped app but a
  proof that the report mechanism is inert — worth saying in 1.3's design before
  a reviewer reads it as the former. The demo's config then *states* every field,
  including the ones already at their default — so the day chat ships, the demo
  turns it on by editing a value that is already there. Chat is the first field
  whose default is **off**: it is a placeholder with no backend (chat-panel:
  "submitted chat input MAY be ignored or echoed locally"), and an unfinished tab
  is clutter locally and a bad first impression on a portfolio link. Two
  consequences, both 1.3's: `ALL_FEATURES` stops being "every capability on —
  what this server does today" and becomes the default report, needing a rename
  and a re-documented comment; and `SidePanel`'s `tabStore` parses
  `raw === 'search' ? 'search' : 'chat'`, so an absent key, an unknown value and
  a recorded `'chat'` all resolve to chat — with chat withheld, every profile
  that never touched the panel opens on a tab that is not there. The file already
  documents this exact hazard for the Similar tab; the fallback becomes `search`
  when chat is withheld.
- Thumbnails **pre-baked, read-only**. PNG is derivable, camera is opinion:
  anonymous `PUT` of PNG bytes for any path is thumbnail defacement, and a
  persisted orbit is a global edit under D4 (camera keyed by path). "Crowd-warmed"
  (other session's open thread) is closed here for that reason.
- Bake at the default lighting mode only, **after** pose-for-every-model — today
  `useThumbnails` poses a tile only when the last search carried a pose
  (`wantsPose = poses[path] !== undefined`), so a bake before that change would
  produce un-posed tiles corpus-wide (verified).
- Index rebuilt against the deployed tree at its deployed path: `hitsToEntries`
  resolves `collection_root + rel_path` and drops non-resolving hits silently;
  `scopeWithin` checks against the same root. Also fixes duplicate results
  (index covers a wider tree than ships).
- Two containers behind Caddy (Hono + corpus, mini-classify); Caddy for TLS and a
  light rate limit on `/api/semantic`. mini-classify serialises queries already,
  so abuse degrades to queueing.
- Semantic states on the demo: `absent`/`volume-gone`/`wedged` collapse to
  "unavailable" (a visitor can't start a service or mount a drive); `warming`
  stays (container boot is real). "not indexed yet — run the classifier" copy
  needs a visitor-facing form.
- Static client served by Hono in `index.ts` (adapter-specific ⇒ D1 puts it
  there). `client/dist` exists from an earlier build; nothing serves it today.
- Kit-dominated results ("dragon" → five files from one kit): leave; flat view
  keeps a kit contiguous (D3).

## Measurements

All re-runnable; say whose run when quoting.

- **mini-classify on CPU** (this session, 2026-08-28, `eval/cpu_dtype.py --report`
  in mini-classify, embed-cache-test, Ryzen 9 7940HS, 8 threads, 16 queries):
  shipped fp16-on-CPU 1.14 s/query, **peak 7.7 GB** (converts the fp32
  checkpoint — would OOM an 8 GB host at startup); fp32 0.31 s, peak 2.8 GB,
  identical rankings; int8 dynamic 0.10 s but top-1 differs on 3/16 and `best_z`
  moves ±1 (declined); text-tower-only no gain (checkpoint is mmapped). Pinned
  to 4 cores: fp32 0.55–0.6 s. **Fixed:** `load_siglip` now picks fp32 off-GPU
  (mini-classify LEARNINGS, "fp16 on a CPU"). GPU warmed: tens of ms (Masa's run).
  Still extrapolated: a real shared cloud vCPU (~1 s guessed) — one paid hour on
  the target instance answers it.
- **Hosting, USD/month, 8 GB always-on, US** (web, 2026-08-28): Vultr $40,
  Fly.io ~$47 + volume/egress, DigitalOcean $48, Linode $48, Hetzner Ashburn
  CPX31 ~$78–85 after the June 2026 increase (no longer the cheap option in the
  US; CX line not offered there; 3 TB traffic). 4 GB tiers $24–28 — now a
  candidate at 2.8 GB peak. Oracle Always Free (2 OCPU/12 GB after a silent
  June cut, enforcement from Aug 18, idle instances reclaimed) — rejected: a
  demo visited a few times a month *is* idle. Hetzner Falkenstein CX33 €8.49
  (~$10, no VAT outside EU) noted, not chosen — US-located preferred.
  **Railway** (this session, 2026-09-02, railway.com/pricing, asked after Masa
  saw "up to 48 vCPU / 48 GB per service" — that is the scaling *ceiling*, not
  an allocation): usage-billed per second — $20/vCPU-mo, **$10/GB-RAM-mo**,
  $0.05/GB egress; Hobby $5/mo incl. $5 credit. This workload is memory-fat
  and idle, the worst shape for usage-billed RAM: SigLIP fp32 holds ~2.5–3 GB
  resident 24/7 (2.8 GB measured peak, Measurements above) ⇒ ~$25–30/mo for
  RAM alone, CPU ~nil at demo traffic, net **~$22–28/mo** — the 4 GB VPS tier
  at less machine, not the cheap option it looks like. Risk: the checkpoint is
  mmapped and cgroup accounting counts page cache, so billed memory may read
  *above* RSS. Railway's app-sleeping mode would cut the RAM bill but is the
  rejected cold-start (wake + 16 s SigLIP load). General rule this surfaced:
  cheap usage-billed platforms discount small-or-idle, and nobody discounts
  RAM-resident-hours. Cheapest viable path remains a flat-rate budget VPS
  (RackNerd/OVH-class 4 GB US at ~$5–10 flat, not yet in the sweep above);
  gate 3.3's paid hour answers whether their shared vCPUs hold the <1 s bar.
  **Checkpoint/restore for scale-to-zero** (this session, 2026-09-02, Masa's
  ask): right shape (snapshot post-SigLIP-load, restore on demand), blocked
  twice over. `docker checkpoint` (CRIU, experimental) needs a privileged VM —
  which is flat-rate, where scale-to-zero saves $0; usage-billed platforms
  that would save money don't allow CRIU. The managed form, Fly.io machine
  suspend/resume (Firecracker snapshots, resume "a few hundred ms",
  storage-only while suspended), has a **hard ≤ 2 GB memory limit**
  (fly.io/docs/reference/suspend-resume) vs our 2.8 GB fp32 peak — and resume
  is not guaranteed (deploy/migration/snapshot loss ⇒ cold boot), so the 16 s
  warming path must exist regardless. The text-tower-only lever this row
  first floated is **measured dead** (Masa's catch, 2026-09-02; this row
  briefly claimed the earlier finding covered only load time — wrong): the
  mini-classify 2026-08-28 run (`eval/cpu_dtype.py`, its fp16-on-a-cpu
  learnings table) shows text-tower-only fp32 at the **same 2.8 GB peak** as
  the full load — `from_pretrained` mmaps the checkpoint and vision pages are
  never faulted, so the full load never paid for vision; the peak is
  query-time working memory (1.2 GB after load, 2.8 GB after the first
  query). Nothing fits under Fly's 2 GB cap; the verdict stands on both legs.
  **Budget flat-rate sweep** (this session, 2026-09-02, Masa's ask; provider
  pages + review sites, re-run at the URLs): **RackNerd** 4 GB/2–3 cores/
  60 GB SSD/multi-US-DC at **$37–60/yr** (~$3–5/mo) — promo stock that sells
  out and does not restock, racknerdtracker.com tracks live offers;
  **Contabo** Cloud VPS 4 (4 vCPU/8 GB/100 GB, NY/Seattle/St. Louis) listed
  €5.50, lands **~$7/mo** in the US per review sites (on-page US surcharge
  unconfirmed — check at order); **OVH US** VPS-1 (2 vCore/4 GB/40 GB NVMe,
  unlimited traffic at 500 Mbps) **$4.54/mo on a 12-month commitment**, VPS-2
  (4/8 GB) $8.50 — the most established operator of the three. All meet
  4 GB+/US/always-on/flat at ≤$9 vs the name-brand $24–28. The open axis is
  CPU: 0.31 s/query on the 7940HS (8 threads; 0.55–0.6 s pinned to 4), and
  budget hosts run older, oversold silicon — 1–2 s is plausible, which is
  gate 3.3's question; RackNerd's *year* costs less than one Vultr month, so
  the paid hour can simply be a paid year. Fit: 4 GB works (2.8 peak + Bun
  app + OS ≈ 3.3, add swap); Contabo's 8 GB removes the headroom worry for ~$2.
  **Managed/usage-billed inference** (this session, 2026-09-02, Masa's ask):
  generic embedding APIs (OpenAI/Cohere/Jina, hosted SigLIP-2) are unusable
  at any price — the cache's vectors are our exact so400m checkpoint's space,
  so the host must run *that checkpoint*: Modal ($30/mo free renewing credit,
  per-second, cold start 2–5 s small models ⇒ text tower **$0/mo** at demo
  traffic), HF Inference Endpoints (per-minute CPU ~$0.03–0.06/hr,
  scale-to-zero, ~30 s–1 min wake), Replicate (per-second, custom-model cold
  starts tens of s). Architecture if taken: only text→vector leaves the box —
  ranking is dot products + z over a ~10 MB matrix, hostable beside Hono on a
  $12–15/yr 1 GB box ⇒ ~$1–2/mo total. Prices: non-monetary — a mini-classify
  embed/rank split, a second external dependency under "link never dead",
  first-search cold start (the kept `warming` state's shape), and an
  embedding-parity re-verification (cache embedded fp16-on-GPU; rankings
  measured dtype-tolerant, but a new runtime re-runs that check). **Verdict:
  not worth ~$3/mo against a zero-moving-parts $4.54 OVH box — but it is the
  designated fallback if gate 3.3 measures >1 s on oversold vCPUs: warm GPU
  inference is tens of ms, fixing latency and cost in one move.**
  **EU origins re-admitted** (Masa, 2026-09-02, relaxing the Decided table's
  US-located row): Hetzner Falkenstein CX33 €8.49 (~$10) and the EU sides of
  Contabo/OVH/netcup re-enter — often better hardware per dollar than their
  US racks. Cost to a US visitor is ~90–150 ms RTT **per round trip, not per
  byte**, so the design lever is trip count, which 1.3 must treat as
  first-class: (a) baked thumbnails and static bundles are immutable — serve
  them with long `max-age`/`immutable` so a visitor fetches each once ever;
  (b) HTTP/2 (Caddy's default) multiplexes the tile-fetch fan-out onto one
  connection — fan-out is fine, *waterfalls* are not (listing → peek → thumb
  is 3 deep; lightbox → overrides rides an open panel, fine); (c) the option
  that mostly dissolves the question: a free-tier CDN (e.g. Cloudflare) in
  front of an EU origin caches thumbnails/static at US edges, leaving only
  `/api/*` crossing the ocean — "EU compute, US bytes". Benchmark before
  deciding (Masa: later): from a US vantage against an EU test box measure
  first paint, a scroll screen of sheets, a lightbox open, one search —
  the per-interaction shapes, not a bare ping.
  **Trip reduction — where it landed** (thread of 2026-09-02, Masa + this
  session; the mechanics now live in changes, which supersede this file):
  the local-app work became **`listing-tree-cache`** (updated in place: pose /
  preview-choice / thumb-state layers beside the snapshot, startup
  revalidation, reload API — its D7–D9), **`immutable-thumbnail-serving`**
  (drafted: write generation, two caching tiers, `no-store` misses), and
  **`bulk-thumbnail-jobs`** (drafted: generate + reset-framings jobs, two
  launchers, the `library` side-panel tab, re-derivable job semantics — its
  D1–D6). Nothing was added to `thumbnail-sweep-priority`: its 2026-09-01
  rebase is the argument for stacking on it, not growing it. What stays
  *here* because no change owns it yet:
  - **GraphQL declined** (Masa floated it; settled 2026-09-02): one lockstep
    client behind the ApiClient seam (D1) buys none of its flexibility, and
    uncacheable per-query POSTs fight the CDN plan — batching and
    edge-caching pull opposite ways, and on a read-only corpus the cache
    wins. Ride-the-listing and batch endpoints stay the two house idioms.
  - **1.3's bake shape — decided 2026-09-02 (Masa): preview paths attached
    to dir entries.** It kills the listing→peek→thumbs waterfall while keeping
    each cell its own image, so the per-cell `title`s keep carrying the display
    names `library-overrides` D7 put there, and the demo runs the same drawing
    code as the local app. The alternative — a precomposed 2×2 sheet PNG, fewest
    trips and bytes — was declined for losing per-cell identity and needing both
    AO variants composed. With the layers landed, the bake is exactly "the caches
    fully warmed, shipped read-only", one code path with the local app. And
    the pose wave gates **off** on the demo (verified: `cached.camera ??
    posed?.camera` — every baked sidecar carries its posed camera, so the
    wave fires as pure waste otherwise).
  - **The feature report** — drafted 2026-09-02 as `server-feature-report`
    (settles this section's `features` bullet: capability report via
    ApiClient, never a mode; that change supersedes this line). 1.3 and
    `bulk-thumbnail-jobs` gate on it; 2.1's orbit routing reads it.
- **Corpus**: see its `NOTES.md` (STL vs GLB sizes, dedup counts, decimation
  gates). `du` on `original/` reads 516 MB vs the notes' 12 GB — hardlink
  accounting order, not a discrepancy.

## Go-live gates (corpus side, not app decisions)

- IP pass by eye over the corpus (one Monster Hunter dragon known).
- ~~`metadata/miniatures.json` backed up or tracked~~ — decided 2026-08-29: regenerable by the
  fetch scripts and gitignored on purpose; not a gate.
- Credits page generated from it (CC-BY requires displayed attribution).
- One paid hour on the actual instance for the query-latency number.
- Optional: Caddy access logs answer "did anyone visit" without an analytics script.

## Other session's briefing — what was checked

Verified true: `openInApps` empty-report behaviour; `wantsPose` gate;
`cached.camera ?? posed?.camera ?? DEFAULT_CAMERA` precedence (stored camera
beats pose); `POSE_VERSION = 2` and `posed:` on the PUT; production serving is
Vite-dev-only. Corrected: corpus path is `test-models/miniatures/clustered-hq/`;
licence mix is 297/297 CC-BY, not "CC-BY/PD"; "flips `posed: POSE_VERSION`" is
the `wantsPose` gate opening for every model, not a version bump — same
consequence (full sweep on the real library), different cause.

## Side effects of the session

- `test-models/CLAUDE.md`: two stale passages fixed (it *is* a git repo; token
  is gitignored and was never committed; `metadata/` is gitignored too).
- mini-classify: `load_siglip` dtype-by-device, its test, `eval/cpu_dtype.py`,
  learnings entry + index + README row. Uncommitted at time of writing.
