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

7. `public-deployment` — **drafted 2026-09-02, applied 2026-09-07** (four staged workers, two review rounds each; archived the same day) — the first of the six changes the demo
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
| Always-on VM, not cold-start serverless | Masa | 16 s SigLIP load + `wedged` UI is the wrong first impression. **Load measured 6.9 s on the CX23 (2026-09-04, Measurements) — but that run was not shown to be cold, and the 16 s it is compared against was a GPU load on another machine; the decision stands and neither number is settled.** |
| CPU-only index, fp32, US-located, 4–8 GB | Masa | see Measurements; GPU warmed is tens of ms, CPU 0.3–0.6 s judged acceptable (<1 s) — **but 0.3–0.6 s was an in-process harness on 8 desktop threads; through `POST /query` the same machine is 0.38 s, a 2-vCPU Hetzner CX23 is 1.23 s and misses the bar, and a 4-vCPU projects to ~0.89 s (Measurements, 2026-09-04)**. **US-located relaxed 2026-09-02 (Masa): EU origins back in consideration pending a visitor-latency benchmark** — and therefore round-trip count is a first-class 1.3 design concern; see the EU paragraph in Measurements |
| **Host: the Hetzner CX23 already probed, as it is** (2 shared vCPU, 4 GB, Falkenstein) | Masa, 2026-09-07 | gate 3.3 measured 1.23 s median on it, over the 1 s bar by ~23%, and that is accepted for launch: getting to deployment outranks the last ~230 ms. The upgrade path if visitors feel it is a resize to a 4-vCPU CX33 or the Modal text-tower fallback in front, and nothing in `public-deployment` or the infrastructure ticket (backlog 1.4) depends on which. This also settles location for launch — an EU box, which the 2026-09-02 relaxation of "US-located" above allowed pending a visitor benchmark that has not been run |
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
   **Added 2026-09-05 (Masa): About also carries a Limitations section**, as examples
   rather than a disclaimer — what semantic search does badly, so a visitor whose query
   fell flat reads it as the tool's edge and not as brokenness. Three to open with: (i)
   **a concept the corpus barely holds returns nothing useful** — search is nearest
   neighbours, so it always answers, and for a query the corpus does not represent the
   answer is whatever is least far, not a "no results"; (ii) **it averages neighbouring
   concepts** — vampires, zombies and skeletons all sit near "undead", so a search for
   one usually brings the others; (iii, added 2026-09-07) **it returns partial matches
   as readily as full ones** — a query with two parts is matched part by part, so "an
   elf carrying an orb" brings back elves, and people holding orbs, beside the elves
   with orbs that were asked for — though a hit meeting more of the query usually
   scores higher, so the full matches tend to lead and the partial ones trail. All
   three are Masa's observations, not
   measurements: like the chips, each example is verified against the live index
   before it becomes copy, and a limitation that stops reproducing is dropped rather
   than kept as lore. The section is backlog 1.5's to draft with the rest of About.
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
  so abuse degrades to queueing. **Superseded 2026-09-07 by `demo-infrastructure`
  (backlog 1.4, drafted):** three containers sharing one network namespace so every
  loopback default holds, only Caddy published, automatic TLS and HTTP/2, **no rate
  limit at launch** for the queueing reason above (the plugin route recorded), state in
  volumes, `deploy/demo/config.json` bind-mounted from the checkout. Read that change's
  design, not this line.
- Semantic states on the demo: `absent`/`volume-gone`/`wedged` collapse to
  "unavailable" (a visitor can't start a service or mount a drive); `warming`
  stays (container boot is real). "not indexed yet — run the classifier" copy
  needs a visitor-facing form.
- Static client served by Hono in `index.ts` (adapter-specific ⇒ D1 puts it
  there). `client/dist` exists from an earlier build; nothing serves it today.
  (`public-deployment` D8 owns the serving; `demo-infrastructure` builds `client/dist`
  into the app image and deliberately does not serve it from Caddy.)
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
  the target instance answers it. **Being answered on Hetzner** (2026-09-04,
  Masa's call — CX33 x86 and CAX21 ARM together): `docs/hetzner-probe-runbook.md`
  is the procedure, `scripts/query-probe.py` the measurement. That probe times
  the *request* (`POST /query`) rather than `cpu_dtype`'s in-process path, so it
  needs its own baseline, measured this session on the 7940HS against the
  running `embed-cache-test` server (2,165 models, device cpu, over localhost):
  **median 381.6 ms, p90 421.0 ms** over the same 16 queries — the number a
  Hetzner run is read against, and re-runnable from the script's docstring.
  **Held to two physical cores** (`CUDA_VISIBLE_DEVICES= OMP_NUM_THREADS=2
  taskset -c 0,1`), the proxy for the 2-vCPU tier, the same box gives
  **median 931.7 ms, p90 1004.3 ms** at **VmHWM 2.78 GB** — so a desktop Zen 4
  *pair* already sits on the 1 s bar before any cloud oversubscription, which
  makes a 2-vCPU host the likely failure case for gate 3.3 and 4 vCPUs the
  configuration the bar was implicitly written for. (Load was 4.6 s here, against the 16 s this
  file cites: the checkpoint was already in page cache from the other running
  server — and the 16 s is a GPU load on this machine, so neither is a cold CPU
  load on a demo host. Nothing has measured that yet.)
- **Gate 3.3, answered on a real box** (Masa's run, 2026-09-04, Hetzner **CX23**
  in Falkenstein — 2 shared vCPU, 4 GB, Ubuntu 26.04, €3.99 + €0.50 IPv4, the
  only cost-optimized type in stock that day; `docs/hetzner-probe-runbook.md`,
  `scripts/query-probe.py`, 16 queries, `serve_api.py --no-volume` on the
  275 MB index): **median 1229.7 ms, p90 1389.3 ms on the box — the 1 s bar is
  missed by ~23%.** Four other results from the same hour, each worth as much
  as the headline:
  - **4 GB is enough.** VmHWM **2.43 GB** (below the 2.78 GB this machine
    shows), 1.1 GB used with the rest page cache, and the 2 GB swapfile took
    68 KB — i.e. never touched. The "4 GB works, add swap" sizing is now
    measured on the target, not extrapolated.
  - **SigLIP load on the box measured 6.9 s** against the 16 s this file has cited
    since 2026-08-28 — but **"cold" is asserted, not shown**: that load ran minutes
    after `hf download` wrote the 4.3 GB checkpoint, so page cache held some of it,
    and the 16 s figure was a *GPU* load (CUDA init included) on a different
    machine. The two are not the same measurement, and the same session that
    correctly discounted its desktop's 4.6 s as page-cache-warm should have
    discounted this. What is safe to say: nothing here has measured a genuinely
    cold CPU load on the target class, and the arguments elsewhere in this file
    that still spend "16 s" (Railway, Fly, Lambda, Cloud Run) are resting on an
    unretired number.
  - **No embedding drift on cloud x86**: top-1 identical to the desktop
    baseline on all 16 queries. The parity question stays open only for ARM,
    which needs a CAX21 (out of stock that day).
  - **The ocean, upper-bounded**: through an SSH tunnel from the US the same
    queries measured **2317.9 ms median**, ~1.09 s over the box-local figure.
    That is a fresh connection per request through the tunnel, so it is an
    upper bound on a keep-alive browser connection (which pays roughly one
    RTT) — the honest visitor estimate is ~1.3–1.5 s, and the real answer
    needs the per-interaction benchmark, not this probe.
  **What it implies for the tier.** Scaling on this box through the same code
  path: 8 threads 381.6 ms, 4 cores 673.8 ms, 2 cores 931.7 ms; CX23's 1229.7
  is **1.32x** the 2-core line, so a 4-vCPU Hetzner (CX33, €6.49) projects to
  **~890 ms median / ~925 ms p90** — inside the bar, but by ~10%, on a
  single-point scaling factor. Verdict: **the 4 GB/2 vCPU tier is out on
  latency while the 4 GB memory argument is confirmed**; the tier that can
  pass is 4 vCPU, and it passes narrowly enough that any contention pushes it
  back over. This is the condition the notes already named for the designated
  fallback — a warm text-tower endpoint (Modal, tens of ms, ~$0/mo at demo
  traffic) in front of a small box, which fixes latency and cost together and
  makes the vCPU count stop mattering.
  **Decided 2026-09-07 (Masa): launch on this CX23 as it is.** The ~23% miss is
  accepted for now — deployment outranks it — and the upgrade, if visitors feel it,
  is a resize or the fallback endpoint in front; neither changes the deployment
  shape, so nothing waits on the choice (Decided table).
  The probe needs no STL volume: `serve_api.py --no-volume` enumerates from
  pose-cache.json, so a box needs ~275 MB of `embed-cache-test` (embeds plus
  records) and the 4.3 GB checkpoint pulled on the box — not the 11 GB corpus.
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
  (4/8 GB) $8.50 — the most established operator of the three. **Both figures
  re-verified 2026-09-04 against OVH's own unauthenticated order catalog**
  (`api.us.ovhcloud.com/1.0/order/catalog/public/vps?ovhSubsidiary=US`, plans
  `vps-2027-model1/2`, prices in ucents, every entry `interval: 1` i.e. per
  month): VPS-1 2027 is 2 cores/4 GB/40 GB SSD/500 Mbps at **$5.35 month-to-
  month, $5.08 on 6 months, $4.54 on 12**; VPS-2 2027 is 4 cores/8 GB/75 GB at
  $10.00 / $9.50 / **$8.50**. So the commitment buys ~15%, and even the
  no-commitment price is single digits — the catalog is the re-runnable source,
  not the marketing page. (The *older* line still in the catalog is worse on
  both axes: "VPS-1 2026" is 1 core/2 GB/40 GB at $7.00/mo, and "VPS-2 2026"
  4 vCore/**4** GB/80 GB at $18.80/mo — a plausible source of a remembered
  "$20-ish OVH", but it is not what VPS-1/2 sell for today.) All meet
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
  **AWS — missing from the 2026-08-28 sweep** (this session, 2026-09-04,
  Masa's ask; on-demand from `ec2.shop?region=us-east-1`, cross-checked
  against instances.vantage.sh; aws.amazon.com/lightsail/pricing;
  aws.amazon.com/vpc/pricing for the IPv4 charge. gp3 $0.08/GB-mo and
  egress $0.09/GB after 100 GB/mo free are **secondary** sources — AWS
  renders those tables in JS — confirm at order): the like-for-like AWS
  product is **Lightsail, not EC2**, it being the only flat-rate form —
  4 GB/2 vCPU/80 GB SSD/4 TB transfer **$24/mo** ($20 IPv6-only), 8 GB/2 vCPU/
  160 GB **$44** ($40). Assembled from EC2 the same 4 GB box costs *more*:
  t4g.medium (Graviton2, 2 vCPU/4 GB) $0.0336/h = $24.53/mo + 60 GB gp3 $4.80
  + public IPv4 $3.65 ⇒ **~$33/mo** (x86 t3.medium $30.37 ⇒ ~$39); 8 GB
  t4g.large $0.0672/h = $49.06 ⇒ **~$59**. A 1-year no-upfront reserved rate
  ($0.0211/h) brings 4 GB to ~$24 and 8 GB to ~$41 — a year of lock-in buys
  the *uncommitted* Lightsail price. Egress is $0 at demo traffic (100 GB/mo free
  against a corpus of 1.8 GB of model files plus baked thumbnails, of which a
  visitor pulls a fraction). No free ride: the 750-hour
  12-month tier was retired 2025-07-15 for new accounts, replaced by $100–200
  of credits that expire in 6–12 months. Verdict: **AWS is the $24–28
  name-brand 4 GB tier this sweep already rejected** — 5× the $4.54 OVH box
  for the same 4 GB — and brings no capability we need: its scale-to-zero
  forms repeat the rejections above (App Runner/Fargate bill provisioned
  RAM-hours, the Railway shape, not priced here; Lambda pays only per request
  but wakes into the rejected 16 s SigLIP load). Two things it *is* good for:
  gate 3.3's paid hour costs **3.4 cents** on t4g.medium, and it answers the
  same open CPU axis as the budget hosts (T-series baseline is 20% of 2 vCPUs
  with burst credits — a demo's 0.3–1 s query bursts fit, sustained crawling
  tips into unlimited-mode surplus; Graviton2 vs the 7940HS is untested here).
  **GCP and Azure** (this session, 2026-09-04, Masa's ask; both priced from the
  vendors' own APIs, re-runnable: GCP `cloudbilling.googleapis.com/v1/services/
  6F81-5844-456A/skus` with `gcloud auth print-access-token` — page it, the
  Compute Engine service is 32,771 SKUs; Azure `prices.azure.com/api/retail/
  prices?$filter=armRegionName eq 'eastus' and armSkuName eq '<sku>'`. Cloud Run
  is service `152E-C115-5142`, Container Apps `serviceName eq 'Azure Container
  Apps'`): **neither has a Lightsail-style flat bundle**, so both are assembled
  like EC2 and land in the same place. GCP us-central1: E2 is $0.021812/vCPU-h +
  $0.002924/GiB-h ⇒ e2-medium (4 GB) $0.0335/h = **$24.46/mo**, e2-standard-2
  (8 GB) $48.92; + pd-balanced $0.10/GiB-mo (60 GB = $6.00) + external IP
  $0.005/h ⇒ **~$34/mo** and ~$59. E2 gets **no** sustained-use discount (SUDs
  are N1/N2/N2D/C2/M1/M2 only — cloud.google.com/compute/docs/
  sustained-use-discounts), so the only lever is a 1-year CUD ($0.0137413/vCPU-h
  + $0.00184182/GiB-h = $0.0211/h) ⇒ ~$25/mo. Azure eastus: the cheap 4 GiB is
  **ARM** — B2pls_v2 (Cobalt) $0.0336/h = $24.53/mo, AMD B2als_v2 $27.45, Intel
  B2s $30.37; 8 GiB D2ps_v6 $51.25 / B2as_v2 $54.90 / B2ms $60.74; + Standard SSD
  E6 (64 GiB) $4.80 + Standard static IPv4 $0.005/h ⇒ **~$33/mo** (ARM) and ~$60.
  A 1-year reservation on B2pls_v2 is $174/yr = $14.50/mo ⇒ ~$23/mo, the cheapest
  *committed* hyperscaler price found. Egress splits them: AWS and Azure both give
  100 GB/mo free (Azure then $0.087/GB, from its API), **GCP gives 1 GiB/mo** and
  then $0.12/GiB premium tier — the only one of the three where a
  thumbnail-heavy demo pays for bytes at all (single-digit $/mo at our volume;
  Standard tier or a CDN in front removes it). Free tiers are irrelevant at
  2.8 GB: GCP always-free e2-micro is 1 GB RAM, Azure's 12-month B1s is 1 GiB.
  Their scale-to-zero forms price out as the Railway row predicted: a warm
  4 GiB Cloud Run min-instance is ~$22–26/mo (instance-based memory $2e-6/GiB-s,
  idle CPU $2.7e-7/s; request-based min-instance rates are $2.5e-6 for both),
  Azure Container Apps ~$35/mo (idle memory and vCPU both $3e-6/GiB-s and /s) —
  and at zero replicas both wake into the rejected 16 s SigLIP load. Cloud Run's
  32 GiB memory ceiling does clear our 2.8 GB peak, unlike Fly's 2 GB suspend
  cap, so it is the only scale-to-zero platform here that *could* hold the model
  — the cold start is what disqualifies it, not the size. **Verdict: all three
  hyperscalers converge at ~$33–34/mo on demand and ~$23–25 with a year
  committed; AWS Lightsail's $24 flat is the cheapest of them, and still 5× the
  $4.54 OVH box.** No new capability, no new argument — the sweep is now complete
  across the big three and the answer did not move.
- **The whole app on the box** (this session with Masa's SSH access, 2026-09-04,
  same CX23): deployed and browsed end-to-end from the US, and the answer is
  that **the CPU was never the problem — the bytes are**. Setup, for the record:
  the shipped corpus (`clustered-hq`, 1.8 GB) rsynced at ~24 MB/s, the repo plus
  `bun install` (Bun 1.4.1) on the box, the client built *locally* (`bun run
  build`, 868 KB JS / 241 KB gzipped) and shipped as `dist`, and a 25-line Bun
  front on 127.0.0.1:8080 serving `dist` and proxying `/api` to 3177. Browsed
  over an SSH tunnel, which is why **no code changed and nothing was exposed**:
  `guard` sees `Host: localhost:8080` and is satisfied, so the loopback posture
  `public-deployment` exists to replace was never touched. The index was
  re-pointed by passing the box's corpus path to `serve_api.py --no-volume`
  (enumeration comes from the cache records, so the rel paths line up with the
  shipped kit dirs) and `/api/semantic/status` came back `ready` with
  `collectionRoot: "/"`.
  - **New deployment finding: SigLIP's 4.5 GB checkpoint fails to mmap on a 4 GB
    box** once anything else holds memory — `unable to mmap 4546331880 bytes`,
    state `wedged`, which the app surfaces as an index failure. `sysctl -w
    vm.overcommit_memory=1` fixes it. The gate-3.3 probe never saw this because
    the index ran alone; any real 4 GB deployment runs it beside the app, so
    this belongs in the deployment's setup, not in an operator's memory.
  - **First screen, root of the corpus (297 folder tiles), from the US**: TTFB
    329 ms, DOMContentLoaded 1.71 s (the uncompressed 868 KB bundle alone is
    1.34 s — the front served no gzip; 241 KB compressed is the honest figure),
    then **19.0 s to settle, 250 requests, 32.5 MB** — of which **28.4 MB is 24
    STL downloads**, the client fetching geometry to draw folder contact sheets.
    Leaving it on the same screen pulled a further **50 MB across 48 STLs over
    29.5 s** as it worked through the folders.
  - **What that means.** Those bytes are the same from Falkenstein or Ashburn:
    this is not an EU-origin problem and not a 2-vCPU problem, it is the
    unbaked-thumbnail problem, and it is exactly what `immutable-thumbnail-
    serving` and `bulk-thumbnail-jobs` were drafted to fix. **The demo cannot
    ship before those two land**, whatever host is chosen — and once they do,
    the first screen becomes cacheable images instead of tens of MB of geometry,
    at which point a CDN in front of an EU origin (the "EU compute, US bytes"
    option) covers almost all of it and the search latency gate returns to being
    the only open question.
  - **Re-measured with the sheets baked** (2026-09-05, after Masa browsed the
    whole corpus so the client's renders were `PUT` to the box — 2,254 PNGs,
    208 MB in the box's thumb cache): the first screen fetches **no STL at
    all**. Returning visitor (browser cache warm): TTFB 172 ms, DCL 1.26 s,
    settle **8.3 s**, 102 requests, **1.16 MB**. First-time visitor, measured
    by re-fetching every thumbnail on the screen with `cache: 'reload'` in
    parallel: **114 PNGs, 9.62 MB, 4.4 s** — so ~10.5 MB and ~5 s all in,
    against **32.5 MB and 19 s** unbaked. `GET /api/thumb/image` already sends
    `cache-control: public, max-age=31536000, immutable`, so the second visit
    costs nothing.
  - **The real encoder, measured** (this session, 2026-09-07, on the box): the figures
    above are `cwebp`'s. Deleting one kit's 43 cache entries and reopening the listing
    made the client re-render and upload them, so the store then held **native 256²
    renders from `canvas.toBlob('image/webp', 0.8)`** — 40 of them, **avg 5.6 KB, median
    5.5, range 2.2–7.6**, all genuine WebP. That is +24% on the proxy's 4.5 KB, which is
    the direction to expect (a native render keeps detail a downscale threw away) and
    small enough that nothing built on the proxy needed revising; against 87 KB of PNG it
    is ~16x rather than ~19x. Fetched back from the US, 39 tiles of that kit cost
    **216 KB in 1.39 s**, served `image/webp` by the image route.
  - **The next lever is the PNG itself: 86 KB average per 512² thumbnail**, and
    a screen holds ~114 of them. That single number is now the demo's dominant
    first-visit cost — bigger than the JS bundle by 10x — and it is a format
    question (WebP/AVIF, or a smaller sheet-sized variant beside the 512² one),
    not a hosting question. Worth measuring before choosing a host, since it
    moves the bytes a CDN would be carrying.
  - **256² WebP, tried on the box** (2026-09-05, Masa's call): the format is
    worth more than the size. Sample of 60 renders, `cwebp -q 80 -alpha_q 100`:
    **512² PNG 87 KB → 512² WebP 10 KB → 256² WebP 4 KB**, i.e. 8.6x for the
    format alone and ~21x for both. Applied for real — `THUMB_SIZE` 256,
    `toBlob('image/webp', 0.8)`, `RIG_VERSION` 6 → 7, `<key>.webp` on disk,
    `Content-Type: image/webp` — and the box's whole baked cache converted in
    place (a resample of the 512 renders, not a native 256 bake, which is close
    enough for bytes and not for pixels): **2,254 files, 208 MB → 9.9 MB, avg
    4.5 KB**. Measured in the browser from the US afterwards: thumbnails come
    back `image/webp` at **5 KB each against 86 KB** — that per-thumbnail pair is
    the sound comparison, and the only one. The two screen totals are **not** like
    for like: 0.28 MB over 2.0 s was a **62**-thumbnail screen, 9.62 MB over 4.4 s a
    **114**-thumbnail one, so the time pair says nothing about the format (per
    request it is ~32 ms against ~39 ms) and an earlier reading of it here as "the
    same screen" was wrong. At 5 KB, a 114-tile screen projects to **~0.57 MB**,
    against 9.6 MB baked-PNG and 32.5 MB unbaked.
  - **What is now the cost is round trips, not bytes.** Thumbnail bytes fell ~17x
    per image while settle time did not follow it down (11.0 s against 8.3 s,
    on screens of different sizes — treat the direction as the finding and
    neither number as a measurement of the other), because the screen is
    ~114 requests each paying an ocean RTT over HTTP/1.1 through the tunnel.
    That is the notes' own trip-count lever, and it is what HTTP/2 (Caddy's
    default) and a CDN in front of an EU origin are for — the bytes argument
    for a US origin is now much weaker than it was two measurements ago.
  - **Sharpness check**: model tiles render at 161 CSS px and contact-sheet
    cells at 79, so 256 is ample at DPR 1 and mildly soft at DPR 2 (a 161 px
    tile wants 322 device px). If retina matters, 320² is the number that
    covers it exactly; the lightbox is a live 3D view and is unaffected.
  - Not yet measured this way: a lightbox open on a single model, and a scroll
    screen deeper in a kit. The tunnel and the box were left up.
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
  **EU options, priced** (this session, 2026-09-04, Masa's ask — the row above
  re-admitted them without numbers; USD at €1 = $1.1622, £1 = $1.353,
  api.frankfurter.dev 2026-09-04; all ex-VAT, which is what a non-EU customer
  pays): **Hetzner** cost-optimized, Nuremberg/Falkenstein/Helsinki only, all
  with **20 TB** traffic and a €0.50/mo IPv4 surcharge — CX23 (2 vCPU x86,
  4 GB, 40 GB) €3.99+0.50 = **$5.22/mo**, CAX11 (2 Ampere ARM, 4 GB) €4.49+0.50
  = $5.80, CX33 (4 vCPU, 8 GB, 80 GB) €6.49+0.50 = **$8.12**, CAX21 (4 ARM,
  8 GB) €7.99+0.50 = $9.87. **The €8.49 recorded above as "CX33" is almost
  certainly CAX21** (€7.99 + the IPv4 €0.50 is exactly €8.49) or a pre-increase
  CX33 — Hetzner raised the cost-optimized line by up to 37% on 2026-04-01 and
  the CPX/CCX lines again in June; confirm at the order page, since
  hetzner.com renders its price table in JS and both figures here are from
  review sites (bitdoze, comparedge), not Hetzner. **netcup** (own site,
  netcup.com/en/server/vps, G12 gen, prices listed incl. 19% German VAT):
  VPS 500 (2 vCore, **4 GB DDR5 ECC**, 128 GB NVMe) €5.91 incl ⇒ €4.97 ex =
  **$5.77**, VPS 1000 (4 vCore, 8 GB, 256 GB) €10.37 incl ⇒ €8.71 ex =
  **$10.13**; locations Vienna/Nuremberg/Amsterdam/**Manassas USA**/Singapore
  — so netcup is not an EU-only choice and can answer the latency question by
  being ordered in the US. **OVH EU** (ovhcloud.com/en-gb, VPS-2027 range,
  incl. 20% UK VAT): VPS-1 (2 vCore, 4 GB, 40 GB NVMe) £3.97 ⇒ £3.31 ex =
  **$4.47**, VPS-2 (4 vCore, 8 GB, 75 GB) £7.55 ⇒ £6.29 ex = **$8.51** —
  i.e. the EU side prices the same as the $4.54/$8.50 US side already recorded,
  so OVH gives no EU discount, only a shorter hop for EU visitors.
  **Contabo** EU is the €5.50 listing above without the US surcharge (~$6.4).
  Summary: EU 4 GB runs **$4.50–5.80**, 8 GB **$8–10**, with better silicon per
  euro (DDR5 ECC, NVMe, Ampere ARM) and far more included traffic than the
  budget US racks — but the open item is unchanged and is *not* price: the
  US-visitor latency benchmark (per-interaction, not a ping) and, if it fails,
  the free-tier CDN in front of an EU origin.
  **Trip reduction — where it landed** (thread of 2026-09-02, Masa + this
  session; the mechanics now live in changes, which supersede this file):
  the local-app work became **`listing-tree-cache`** (updated in place: pose /
  preview-choice / thumb-state layers beside the snapshot, startup
  revalidation, reload API — its D7–D9), **`immutable-thumbnail-serving`**
  (drafted: write generation, two caching tiers, `no-store` misses), and
  **`bulk-thumbnail-jobs`** (drafted: generate + reset-framings jobs, two
  launchers, the `library` side-panel tab, re-derivable job semantics — its
  D1–D6). Nothing was added to `thumbnail-sweep-priority`: its 2026-09-01
  rebase is the argument for stacking on it, not growing it. The trip the
  click itself spends — listing, then thumbnails, serially — became
  **`hover-prefetch-listings`** (drafted 2026-09-03, **parked until
  `public-deployment` lands**: folder and zip tiles warm their listing after
  the model tiles' linger, the click lands from it with no request, and the
  first screenful of already-rendered thumbnails is fetched into the browser
  cache behind the hover; invisible locally at 5–8 ms per listing, which is
  why it waits for a hosted origin to measure against). What stays *here*
  because no change owns it yet:
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
