# Tasks — entry-context-menu

> **Rebased onto main at `baa7010`.** Every prerequisite this change was written behind is
> archived: `search-matches-folder-names`, `find-in-listing`, `search-options`,
> `semantic-search`, `semantic-search-tuning`, and `search-view-reducer`. Nothing blocks
> section 4 any more — the index client, the results-replace-the-grid path and the pose
> plumbing all shipped. What did *not* ship is the dismiss affordance section 4 planned to
> reuse; see 4.6.
>
> **Hard ordering, by file rather than by requirement.** No active change MODIFYs a
> requirement this one does. But `lighting-refreshes-thumbnails` and
> `thumbnail-sweep-priority` both rewrite `useThumbnails.ts`, which §4b edits, and this
> change is the only one editing `server/src/cache.ts`. Land §4b **after**
> `lighting-refreshes-thumbnails` if both are in flight — it changes the sweep's trigger and
> its dependency list, which 4b.1 resolves the orientation against — and re-read
> `useThumbnails.ts`, `state/*.ts` and `App.tsx` against main immediately before editing.
>
> **§4 rewrites the state layer's subject field** (`View.q` → `View.subject`, design D4).
> That touches `state/view.ts`, `state/reducer.ts`, `state/selectors.ts`, `lib/urlState.ts`
> and `App.tsx` — the files `search-cancellation` also names. Do §4.0 as one commit of its
> own, with the reducer unit suite green, before anything is built on top of it.
>
> Sections 1–3 depend on nothing but each other and can be split out first.

## 1. The shared action module

- [x] 1.0 The action module needs the index's poses to resolve an orientation. They live on
      the landed answer now (`state.result.poses`, `reducer.ts:73`), derived in `App.tsx:251`
      and passed to `useThumbnails` and `ViewerLayer`; plumb the same value to the action
      module rather than reading it anywhere new. Note the consequence: `poses` is populated
      by a meaning *or* a similarity landing — similarity hits ride the same `hitsToEntries`
      and carry poses — so outside a meaning or similarity grid every model takes the no-pose
      branch and reset framing gives the default. That is correct — there is no pose to hand
      back — but it means 4b.3a's posed cases are only reachable from a meaning or similarity
      grid, which is where its App-level tests belong.
      **Done:** `poses` is a field on `ActionHost` (`client/src/lib/entryActions.ts`), fed
      from App's existing `state.result.poses` derivation — read nowhere new. No Stage-B
      command reads it; *reset framing* (§4b) is its reader, and typecheck holds the
      plumbing in place until then
- [x] 1.1 An entry-actions module owning one definition per command — open, reveal, copy
      path, find similar, re-render thumbnail, reset framing — each taking an entry and the
      app callbacks it needs, with the per-kind availability table from D6 in one place
      rather than at each call site. The two view-changing commands take `dispatch` and
      nothing else (D8): no command builds a URL, calls `pushState`, or touches
      `window.history`.
      **Done:** `ENTRY_COMMANDS` in `client/src/lib/entryActions.ts` — one row per command,
      each carrying its `applies` (D6's table, drawn in the module doc comment) and its
      `run`. The two thumbnail rows carried `run: null` through Stage B and were therefore
      defined but not rendered; §4b filled both, so every row has a body and the table renders
      whole. `reveal` goes through `host.navigate`, `findSimilar` through
      `host.dispatch`; nothing in the module touches `pushState`, `window.history`, or a
      query string
- [x] 1.1a Build the brief-failure affordance the copy command reports through, or adopt one.
      Nothing in `client/src` renders a toast today; the two existing surfaces are
      `ViewerLayer`'s inline `copied` state (`ViewerLayer.tsx:85`), which is per-panel, and
      `PathBar`'s `error` prop (`App.tsx:971`, fed from `state.failure?.message`), which is
      the app's one place for transient failure text. Prefer extending the latter to
      inventing a second transient surface — but note it is now reducer-owned, so a
      clipboard failure routed there is either a local override at the `PathBar` call site or
      a new failure kind; decide at apply and say which, so nobody builds a third.
      **Decided: a component-local override at the `PathBar` call site.** Not a failure kind
      — `state.failure` carries a `forView` a clipboard refusal has none of, and the next
      landing would clear a message about an unrelated act. Not a third surface — App's
      `actionText` cell feeds `PathBar`'s `error` (failures) and a new `notice` prop (the
      confirmation): the same one line, two tones. The *sentence* is shared, as `COPY_FAILED`
      in the action module. Recorded in design.md D2 under "Where that report is rendered"
- [x] 1.2 `copyPath` becomes a command over the entry: it takes the row and reads
      `entry.path`, the virtual path, unchanged (D2). It does **not** carry
      `selectPathText` (`ViewerLayer.tsx:366-378`) with it — that fallback ranges over
      `pathRef.current`, the panel's rendered `<p>` (`:555`), which a menu does not have,
      and it defends a non-secure context this app does not target. A failed write shows a
      brief report instead, from whichever surface invoked it.
      **Done:** `copyEntryPath(entry, feedback)` — the one body, over `entry.path` verbatim
      (zip notation asserted). The synchronous-throw `try` came along; `selectPathText` did
      not
- [x] 1.3 The lightbox's copy affordance calls the shared command. `selectPathText`,
      `pathRef`, and the panel's bespoke try/catch go with it; the `copied` confirmation is
      presentation and stays per surface. Its existing tests need updating for the new
      failure path — that is the one behavior this move deliberately changes.
      **Done:** `ViewerLayer.copyPath` is now a call to `copyEntryPath` with the panel's own
      confirm/report; `selectPathText`, `pathRef` and the try/catch are deleted, and the
      panel gained a `role="status"` line for the report. `viewerLayer.test.tsx`'s copy test
      is renamed and extended for the new path — the only existing test this stage changes
- [x] 1.4 Land the `model-viewer` MODIFY with it: *Lightbox expanded view* currently
      requires the panel to select the path text on failure, so the shipped spec is false
      the moment the brief report replaces it. Every other scenario of that requirement is
      carried forward in the delta.
      **Verified, not rewritten:** `scripts/spec-diff.sh model-viewer entry-context-menu`
      shows the delta differing from main in exactly the copy-failure sentence and its
      scenario, with all twelve scenarios carried. It matches what shipped

## 2. The menu

- [x] 2.1 A context-menu component: raised at the pointer, kept inside the viewport, closed
      by choosing an item, Escape, or an outside interaction.
      **Done:** `client/src/components/EntryMenu.tsx`. Position clamped by the exported pure
      `clampToViewport` — a happy-dom rect is all zeros, so the clamp is unit-tested as a
      function and its application asserted as a style. Dismissal: choosing, Escape, an
      outside pointerdown, an outside contextmenu, a wheel
- [x] 2.2 Wire it to tiles in `Grid.tsx`. `App.tsx:770-772` already returns on
      `e.button !== 0`, so nothing more is needed to keep a secondary press from orbiting —
      assert that in a test rather than trusting it, since it is one early return away from
      regressing. `Grid` and `Tile` are memoized on their handlers (`Grid.tsx:22,45`), so the
      menu handler must be held by identity in `App` like the others or every tile re-renders
      per keystroke.
      **Done:** `onEntryMenu` is a `useCallback` in App. The mark reaches `Tile` as a
      per-tile boolean, so only the marked tile re-renders. (The `Tile` memo is at
      `Grid.tsx:43`, not `:22,45` — trust the file.) Asserted, not trusted: *opens on a
      secondary press without orbiting or opening the viewer* fails when the `e.button !== 0`
      return is deleted
- [x] 2.3 Keyboard access: the platform's context-menu key on a focused tile, arrow keys
      within the menu, Escape to close, focus returned to the tile. Escape is contended —
      `App.tsx:571` closes the find control on Escape whenever it is open and no viewer is
      mounted — so the menu has to win while it is raised.
      **Done.** `contextmenu` covers the platform key on a focused tile; Shift+F10 is handled
      beside it; arrows/Home/End move focus within the menu; Escape closes it and focus
      returns to the tile. **How the find control loses:** App's window listener gains a
      `menuOpenRef` test beside the `viewerRef` one it already had — the same idiom for the
      same reason ("the thing on top owns Escape"), and it is a ref rather than event flags
      so the outcome does not depend on listener order or on where focus is. The menu closes
      itself from its own window listener. With no menu raised the ref is false and find's
      Escape is untouched; one test asserts both halves, and it fails when the ref test is
      removed
- [x] 2.4 Raising or dismissing the menu starts and cancels no thumbnail work and does not
      suspend the render queue — it is not a viewer. The suspension is keyed off `viewer`
      (`App.tsx:524-527`), which a menu never sets, so this is an assertion to pin rather
      than a guard to add.
      **Pinned** by spying `RenderQueue.prototype.suspend` across a raise
      (`entryMenu.test.tsx`)
- [x] 2.5 Find similar reads availability from `state.index` — the reducer's own cell, kept
      by identity when a poll says nothing new (`reducer.ts:442-445`) — rather than probing
      the index when a menu opens (D6).
      **Done:** `commandsFor(entry, { index: state.index })` and nothing else. The test
      asserts the item is absent for `absent`, `warming` and unprobed, *and* that the
      `indexAvailability` call count is unchanged across the raise

## 3. Reveal

- [x] 3.1 Navigate to the containing folder, deriving it from the entry's vpath — for an
      archive entry, the directory inside the archive (`foo.zip!/parts`). It is one
      `commit({ type: 'navigate', path, prefs: ownPrefs() })` and nothing else (D8): the
      history push comes from the landing's provenance (`App.tsx:310`), latest-wins and the
      skeleton come from the ordinary request path, and no URL is assembled anywhere.
      **Done:** `containingFolder` in `entryActions.ts` — an archive entry lands inside the
      archive, an entry at the archive's root lands on the archive, and an entry at the fs
      root bottoms out at `/` rather than `''`. `reveal` calls `host.navigate`, which is
      App's one `commit({ type: 'navigate', … })`; the push is the landing's (asserted: one
      history entry)
- [x] 3.2 Locate on arrival. The `pendingModel` cell this task used to name is gone — the
      deep-linked model is a view field now — so the pattern to follow is the effect at
      `App.tsx:645-660`: hold the payload, act only when `state.result !== null &&
      state.inflight === null && state.failure === null`, honor it if the entry is in
      `state.result.entries`, drop it silently if not. The mark itself is **component-local
      state**, not a view field and not a draft (D8): the reducer never reads a highlight,
      which is the same rule that kept `findText` local.
      **Done:** the locate effect sits beside the honor-or-drop effect it patterns on, under
      the same settled-answer gate. `pendingReveal` and `marked` are `useState` in App — no
      view field, no draft. Reveal arms the mark **after** calling `navigate`, whose reset
      would otherwise clear it; swapping those two lines fails the reveal test
- [x] 3.3 Scroll the entry into view and mark it for a second or two, then fade. Nothing in
      `client/src` calls `scrollIntoView` today, so pick the block/inline behavior
      deliberately — a tile landing under a sticky header is not located.
      **Done:** `Tile` scrolls itself on becoming marked, `{ block: 'center', inline:
      'nearest' }`, instant. `center` deliberately: nothing is sticky today — the header sits
      *outside* the scrolling `<main>` — but `center` keeps the tile off the top edge, where
      the notice row sits and where a sticky header would go, and it reads as "here it is"
      rather than "it is somewhere above". `nearest` inline because the grid never scrolls
      sideways. Instant because the listing has only just appeared. The fade is a CSS
      animation (`index.css`, `reveal-mark`, 1.8s) rather than a class swap, so it competes
      with no `transition-colors` and needs no second JS timer.
      **Pixels not yet judged** — the ring's colour, width and timing are a visual-tuning
      call, so this box is code-complete but not sign-off complete
- [x] 3.4 The flat toggle is untouched (D3) — **already true**: `reducer.ts:294` carries
      `flat: liveView(state).flat` across a `navigate`. This task is now the test, not the
      guard: revealing from flat lists the destination flat, revealing from nested lists it
      nested.
      **Done as a test:** *leaves the flat toggle alone* — reveal from a flat view lands flat
      and the URL still carries `flat=1`. No code changed
- [x] 3.5 The mark is ephemeral — absent from the URL, not restored by Back or reload, and a
      no-op when the entry is missing from the listing that arrives. Reset it beside the two
      existing ephemeral resets, `App.tsx:370-371` (navigate) and `:633-634` (popstate), so
      there is one place a new one gets added.
      **Done:** both cells reset inside `navigate` (beside the find-text reset) and in the
      popstate handler (beside its own), the two places named — so a third ephemeral cell has
      one obvious home. Absent from the URL by construction. A missing entry drops silently.
      *marks nothing when history brings the folder back* fails when the popstate reset is
      removed. (The reload case is asserted too, but it is not falsifiable: a reload remounts
      App, so it holds structurally — as does "nothing marked" for a missing entry, since a
      tile that is not rendered cannot carry the class. Both are conformance assertions, and
      the honor-or-drop check earns its place by not arming a 1.8s timer for a tile that
      isn't there)

## 4. Find similar

- [x] 4.0 **The view gains a subject (D4), as its own commit.** `View.q: string | null`
      becomes `View.subject: { kind: 'none' } | { kind: 'query'; text } | { kind: 'similar';
      model }`; `View.mode` is untouched and stays the corpus a typed phrase goes to. Every
      `view.q === null` becomes a `.kind` test. Touches `state/view.ts`, `state/reducer.ts`,
      `state/selectors.ts`, `lib/urlState.ts`, `App.tsx`. Judge it by the reducer's existing
      unit suite plus `searchOptionsUi`, `fileNameSearch`, `urlNavigation`, `urlLightbox` and
      `semanticSearch` — the same gate `search-view-reducer` commit 2 was judged by
- [x] 4.0a `corpusOf` (`view.ts:155-160`) gains `'similar'`, sharing `defer`/`wait` with
      meaning: `wait` while the availability probe has not answered, `defer` with a nested
      stand-in once it has said not-ready. `standInOf` sets the subject to `none`;
      `endDeferral` clears the subject rather than nulling `q`. One function, one new case —
      no second opinion about which corpus answers a view (R6)
- [x] 4.0b `requestOf` gains `{ kind: 'similar'; path; model; k }` and `sameQuestion` gains
      its arm. `path` is in the request for **identity**, not for the server — no scope is
      sent (4.1a) — because without it two similarity views of one model at different folders
      compare equal and take `restore`'s patch branch, which cannot patch `path`. Rewrite the
      `Request` doc comment (`view.ts:79-87`), which today says the type is "the closed list
      of what the server is told": it is the closed list of what *identifies* the question,
      and the anchor is the stated exception. Do **not** widen `sameQuestion` to compare
      `path` generally
- [x] 4.0c `serializeView`'s gate generalizes from "a committed query, under the mode that
      reads the option" to "the subject that reads the option". A `similar` subject writes
      `similar=<vpath>` and no `q`, `mode`, `nofolders`, `kinds`, or tuning; `path`, `flat`
      and `model` are written as before. `parseUrl` reads `similar` and, given both `q` and
      `similar` (which the serializer cannot write — only a hand-edited link), resolves the
      similarity view and lets the stray `q` ride until the first commit rewrites it, which is
      the leniency `urlState.ts:37-45` already documents. `optionsOf` is untouched
- [x] 4.1 `ApiClient` gains the similar call, beside the semantic query (D1: no raw fetch in
      components); the server proxies it and joins hits to listing data through the same path
      `semantic-search` built. It is driven by the fetch effect off `pendingRequest`
      (`App.tsx:297-363`) like every other request, tagged with the asking event and the
      question as asked, and aborted when superseded.
      **Landed**: `similar()` in `server/src/semantic.ts` (sharing `askIndex`, one copy of the
      error contract, with `query`), `POST /api/semantic/similar` in `server/src/app.ts`,
      `ApiClient.similar` + `HttpApiClient.similar`, and the real arm replacing the abort-only
      stub in `App.tsx`. `server/test/similar.test.ts` pins the join and the four failure
      lanes; `client/test/findSimilar.test.tsx` pins the call arguments (model, `SIMILAR_K`,
      an `AbortSignal`) and that a superseded question is really aborted
- [x] 4.1a Send no scope: neighbours come from the whole indexed collection (D4). The index's
      `scope` is optional and defaults to the collection, so this is stating a default rather
      than passing a value — and it differs from meaning search, which is rooted at the
      browsed directory. A reviewer seeing two sibling result views scoped differently should
      find the reason written down.
      **Landed**: the reason is in `similar()`'s doc comment and in the route's, and the
      absence is a test rather than an assumption — *sends no scope: neighbours are
      collection-wide*, falsified by sending the model's folder as a scope
- [x] 4.2 Choose `k` deliberately rather than inheriting either default: the index's is 10,
      this app's text-query bound is 60. Neighbours degrade faster than text matches. It is a
      module constant, not a view field and not a URL param (D4) — nothing on screen sets it.
      Leave the index's `pool` at the server default for the same reason.
      **`k` landed with 4.0** (`SIMILAR_K = 16`, `state/view.ts`). `pool` is closed here: the
      server sends `path` and `k` only, stated in design D4 and pinned by the same test
- [x] 4.3 The view goes in the URL and into history through the one writer and nothing else:
      the `similar` transition asserts its subject, leaves a `urlIntent`, and the projection
      at `App.tsx:278-287` serializes the whole view (D8). No hand-built literal — abolishing
      those is why the projection exists. Land the `url-navigation` MODIFY with it; it carries
      main's current text plus this change's scenarios, and corrects one stale sentence about
      the mode (flagged in the delta's header).
      **Verified end to end, from both ends.** The dispatch→ask→land→serialize half is
      `searchReducer.test.ts`'s *a similarity URL names the model, the place and the toggle*
      (dispatched subject, non-default options, `serializeView` over the landed view). The App
      half is `findSimilar.test.tsx`'s *names the model, the place and the toggle in the URL*:
      a link in, the options non-default in storage and named nowhere, and then the one write
      a similarity view can actually make from inside the app — the dismissal — rewriting the
      whole URL, similarity params and never-read options leaving together, one history entry.
      No literal is built anywhere. Note the shape of what is *not* provable at DOM level yet:
      entering a similarity view from within the app needs the menu (§2), and every other
      landing serializes to what the address bar already says, so `commitUrl` declines the
      write. That is the documented leniency, not a gap
- [x] 4.4 Availability is optimistic (D4): offered on models inside the indexed collection
      and outside archives, with no per-tile round trip to the index.
      **State half landed**: `indexCovers(index, path)` in `state/selectors.ts` — inside the
      collection root, outside an archive, read off `state.index` with no probe. `SidePanel`'s
      own copy of that rule is folded onto it rather than left to drift. The per-kind table
      that reads it is §2's.
      **Menu half folded on at Stage C**: `similarApplies` had kept its own two-thirds of the
      rule (a model, not in an archive, index ready) and never asked about the collection, so
      the menu offered the action on a model the index would have refused on scope. It now
      calls `indexCovers`, which answers the archive half too — one rule, three readers.
      `entryActions.test.ts` and `entryMenu.test.tsx` both pin a model outside the collection
      root offering no find similar
- [x] 4.5 Two distinct failures: not yet embedded (404 from the index — fixable by running
      the classifier) versus inside an archive (outside the corpus by construction, knowable
      client-side without asking). Different sentences.
      **Landed**: the 400/502/503 mapping in `app.ts` gains one clause — an upstream 404
      passes through as a 404, since it is a statement about the *requested resource* and the
      only upstream status the UI owns a sentence for (approved at check-in; the index's other
      4xx, its 422s, still map to 400). The client dispatches on the status, never on the
      index's words. The archive case makes no request at all: the fetch arm refuses a `!/`
      subject, which is how a shared or hand-edited link reaches the sentence at all, since
      the menu does not offer the action there. Both sentences tested, both falsified
- [x] 4.6 **Build the dismissal; it was never built** (D9). This task said "reuse
      `semantic-search`'s dismiss affordance"; the rebase found there is none — the only exit
      from a committed search is emptying the input (`reducer.ts:350-358`), and `FindBar`'s ✕
      (`FindBar.tsx:70`) dismisses the filter, not the search. That exit is also inert for a
      similarity view, which has no text in the input to empty. So: one `clearSubject`
      transition (subject → `none`, `endDeferral` on the way through, re-ask the listing), the
      empty-input path delegating to it rather than keeping its own copy, and **one** visible
      control rendered for any committed subject — query or model — beside the results label.
      That is what makes the delta's "the same dismissal" literally one control.
      **State half landed with 4.0**: the `clearSubject` action and the private `leaveSubject`
      the `queryText` empty path now delegates to, with both-kinds and end-the-deferral cases
      in `searchReducer.test.ts`. What remains is the visible control.
      **UI half landed**: one `✕ Dismiss` in `noticeBar`, beside the label, gated on the
      **live** subject rather than the answered one — which is what lets ONE control serve a
      landed result *and* a deferral, whose stand-in answer is about the folder and would
      report nothing committed. A second copy in the banner is the two-that-resemble-each-other
      D9 refuses. Tested over both kinds of subject in one case, and falsified by re-gating it
      on the answered subject (the deferred case then loses its way out).
      **Revised here, reversing a Stage A sub-ruling**: the `similar` transition now clears
      `drafts.queryText` as `navigate` does. Left alone, stale text under a similarity view
      is a trap — erasing it is the natural gesture for a stale box, and erasing it runs the
      shared leave-subject rule and destroys the view. Recorded in design D9's margin; one
      reducer case, falsified
- [x] 4.6a A deferred similarity view gets a banner. `App.tsx:252` derives the banner's text
      from `state.view.q`, which is `null` for a similarity subject, so today's code would
      defer silently — the one state whose whole purpose is to explain itself. It names the
      model, and it offers only the dismiss: "search names instead" (`App.tsx:1070-1076`,
      `deferredToName`) needs a phrase, and there is none.
      **Landed**: the banner branches on `state.view.subject` rather than on a phrase — "This
      view is the models similar to “hero.stl”, and the index is …" — and the name-corpus
      offer is rendered only for a query. Its only offer is the dismiss, which is 4.6's one
      control in the line directly below. Both halves tested (the offer absent for a model,
      still present for a phrase)
- [x] 4.6b `labelInputs` (`selectors.ts:106-121`) learns the subject. It reads `forView.q`
      today, so a similarity result renders a blank label **and** leaves
      `searchHasNoMatches` (`App.tsx:749`) false — which gates every "nothing matched"
      sentence, so an empty similarity result falls through to `Grid`'s bare "Nothing to show
      here." Test the empty case, not only the populated one.
      **Selector half landed with 4.0**: `labelInputs` and `controls` return the `subject`
      rather than a query string, and `searchHasNoMatches` gates on it — so an empty
      similarity result now reaches the "nothing matched" branch.
      **Copy half landed**: a populated view labels itself *Models similar to "hero.stl", from
      across the collection.*; an empty one says *Nothing in the collection is similar to
      "hero.stl" — the index holds no neighbours for it*, decided ahead of every branch below
      it, all of which are about a phrase. Falsified by removing that branch: the empty view
      then renders `Nothing matched ""`, which is the 4.6b failure exactly. Both name the
      model by base name — the full vpath is in the URL, which is where an identity belongs
- [x] 4.7 No per-result score or z on the tile (`semantic-search` D10): order carries
      strength. Similarity cosines run 0.85–0.99 against text queries' ~0.1, and the index
      reports no `weak` flag here for that reason — `labelInputs`' `weak`/`capped` terms are
      meaning-query residue and stay absent from a similarity label rather than reading as
      `false`.
      **Landed**: the similarity label repeats neither clause, and the residue never reaches
      the client to be rendered — the server's answer is `{path, entries, poses}` and nothing
      else, so the index's `scope` dict cannot make `labelInputs.meaning` true. Tested on both
      sides (the response's key set; no `0.xx` anywhere on screen, none of the meaning
      clauses). **Visible consequence, deliberate:** the side panel's coverage line ("N of M
      models here are indexed") does not render for a similarity view — it is a fact about a
      phrase's scope, and it stays absent for the same reason an inapplicable option does

## 4b. Thumbnail actions  *(the actions land with §1–3; their posed cases need a meaning or similarity grid)*

- [x] 4b.1 Re-render: resolve the orientation exactly as the sweep does
      (`useThumbnails.ts:194-199` — stored camera/axis, else the pose when *both* are absent,
      else the default), render through the queue, and `putThumb` **no viewpoint — pixels
      plus the labels that describe them** (`lighting`, `rig`, and `posed` where a pose drew
      them). "Pixels only" in the sense of omitting the labels is not a smaller write but a
      broken one: `server/src/cache.ts:108-110` clears every label a PNG-bearing PUT omits,
      so the hit test fails for ever after and the tile re-renders on every visit. Do not
      persist a pose: `semantic-search`'s *A pose orients the model without becoming its
      stored camera* forbids it, and the sweep's own comment says the same. Test a posed
      model: after re-render it still has no stored camera or axis, so a re-classification
      still governs it — and it declares `POSE_VERSION`, so the next visit is a hit rather
      than another re-render (4b.6).
      **Done:** `refreshThumbnail` in `client/src/lib/entryActions.ts`, behind
      `ENTRY_COMMANDS`' `reRenderThumbnail` row. The resolution is the sweep's, branch for
      branch. Pinned in `client/test/thumbnailCommands.test.ts` — the stored-orientation
      case, the posed case, and a **round trip** (`what the next visit makes of the pixels`)
      that replays the PUT through a fake cache keeping `cache.ts`' own two rules and then
      mounts `useThumbnails` over it: the tile is served, not re-rendered. Falsified twice,
      by dropping `posed` and by dropping all three labels — the round trip fails both ways
- [x] 4b.2 The orientation store gains *discard* (`model-thumbnails` MODIFY), for the axis as
      well as the camera. `server/src/cache.ts:104-105` is `camera: opts.camera ?? prev?.camera`
      / `axis: opts.axis ?? prev?.axis`, so silence means keep and there is no way to clear —
      add an explicit discard to `ThumbPutRequest`/`ThumbCache.put`, keeping silence meaning
      keep. Server test all three states per field: set, silent, discarded.
      The delta's *other* new sentence — that a read reports a missing axis rather than
      substituting +Y — is **already shipped** (`server/src/cache.ts:72-78`); it is in the
      delta to make main true, not to be implemented again.
      **Done:** the wire word is `null` — `camera?: CameraState | null` / `axis?:
      OrbitAxis | null` on `ThumbPutRequest` (`shared/types.ts`) and `ThumbSave`
      (`client/src/api/client.ts`), read by `ThumbCache.put` as
      `opts.camera === null ? undefined : (opts.camera ?? prev?.camera)`. No new route and no
      new verb: JSON drops `undefined` and keeps `null`, so absence goes on meaning keep by
      itself. `app.ts`' axis validator had to learn that a null axis is a discard rather than
      a bad axis. Three states per field in `server/test/cache.test.ts`, plus the wire in
      `server/test/api.test.ts`; falsified by restoring the old merge (both fail)
- [x] 4b.3 Reset framing discards rather than writes `DEFAULT_CAMERA`. The distinction is the
      task, not a nicety: a stored default makes `cached.camera !== undefined`, which at
      `useThumbnails.ts:194-196` permanently disqualifies the model from the pose path — the
      fix for a badly framed thumbnail would guarantee one. Test that a posed model, after
      reset framing, renders at the pose and not at the default.
      **Done:** the same `refreshThumbnail`, with `discardFraming` — one body, since the two
      commands differ in that answer alone and in nothing after it. Two cases in
      `thumbnailCommands.test.ts`: the posed model renders at the pose, and `never writes a
      default in place of the discarded camera` pins the distinction directly
- [x] 4b.3a Reset framing discards the **axis too when a usable pose exists** for that model,
      so the pose applies entire (D7). Gate on `cameraForPose(...) !== null`, not on the raw
      presence of a pose: a malformed one (off-axis `up`, non-perpendicular `azimuth_zero` —
      `pose.ts:85-92`) returns null, and trading a real axis for `'y'` there would be worse
      than keeping it. Use that predicate and no other — in particular do **not** add a
      `front === null` exception: `pose.ts:97-101` keeps such a pose deliberately ("the
      orientation is still worth keeping — only the angles are missing"), the sweep applies it
      to any untouched model, and reset framing's whole promise is to return the model to what
      an untouched one gets. A second opinion about what counts as usable is the drift
      `lighting-refreshes-thumbnails` D1 warns about.
      With no usable pose, discard the camera alone. Test all three: posed + stored axis →
      both discarded and the pose applies; malformed pose → axis kept; no pose → axis kept.
      **Done:** `const dropAxis = discardFraming && pose !== null`, where `pose` is
      `cameraForPose(host.poses[entry.path], DEFAULT_CAMERA)` and nothing else — no
      `front === null` exception, which `treats a pose with no cached front view as usable`
      pins as a test in its own right. The gate reads **the view's** poses, so the command's
      reach follows the grid's provenance: a plain listing knows no poses and the axis
      stands, which is *the user's own choice wins* working rather than failing. The
      entry-actions scenario *Giving up an orientation hands the model back to the index* was
      rewritten under its title to say so. All three cases in `thumbnailCommands.test.ts`;
      falsified by widening the gate to `discardFraming` (the axis-kept case fails)
- [x] 4b.4 Reset framing also updates the in-memory thumb state, not just the server:
      `App.tsx:1184-1185` sources the lightbox's camera and axis from
      `thumbs.get(viewer.entry.path)`, so a server-only write leaves the viewer opening at the
      old camera for the rest of the session. `setThumb` (`useThumbnails.ts:83-89`) is the
      handle. Test the viewer within one session, not only after a reload.
      **Done:** both commands end in one `host.setThumb` carrying the new pixels and the
      orientation as it now stands — `camera: undefined` after a discard, `cached.camera`
      after a re-render. Tested within one session in
      `client/test/thumbnailActions.test.tsx`, which mocks `ViewerLayer` to read the `camera`
      and `axis` App hands it: open → reset framing → open again, no reload. Falsified by
      deleting the `setThumb` call (that case fails, with five unit cases beside it)
- [x] 4b.5 Re-render never touches `axis`. Test with a non-`y` spindle stored: it survives
      re-render whether or not a pose exists, and the render is drawn about it. Reset framing
      is the only path that moves the axis, and only under 4b.3a's gate — a discard that left
      a Z-up model laid on its side with nothing to replace the axis is the failure D7 refuses.
      **Done:** re-render's PUT sends `axis: undefined` unconditionally — silence, which the
      store reads as keep. `never moves the axis, whether or not a pose exists` runs both
      ways round: with a `-z` spindle stored the render is drawn about `-z`, the PUT carries
      no axis, and the pose is withheld entire (so no `posed` label either), since a stored
      axis alone is enough to withhold it
- [x] 4b.6 Both `await queue.whenResumed()` before touching the renderer, as the sweep does
      at `useThumbnails.ts:177,181` — `queue.push` alone is not enough, since
      `queue.ts:39-47` documents that `suspend()` cannot stop a job that has started, and
      this is the single shared `WebGLRenderer` (architecture D2/D3). Neither bumps
      `RIG_VERSION` — they consume the current recipe. But a render made under a pose MUST
      declare `POSE_VERSION` (`three/pose.ts:26`, a third pixel-recipe label beside lighting
      and rig): `server/src/cache.ts:110` clears `posed` on any PUT carrying a PNG, so a
      "pixels only" write drops the label and the next meaning-grid sweep sees `poseStale`
      and renders the tile again. It self-heals — that sweep writes the label back
      (`useThumbnails.ts:208`) — so the cost is one wasted render rather than a loop, and only
      where poses exist at all. Declare it anyway: a thumbnail that lies about which recipe
      drew it is the thing `posed` was added to stop.
      **Done:** two gates, either side of `lru.acquire`, exactly as the sweep places them. No
      `RIG_VERSION` bump was needed or made — both consume the current recipe. `POSE_VERSION`
      is declared wherever a pose drew the pixels, on both commands. The first test written
      for this passed with **both gates deleted** — `push` never starts a job while the queue
      is suspended, so it was testing the queue's pump, not the gate. Rewritten as the case
      that actually needs it: the job starts, a viewer takes the renderer while the mesh is
      loading, and the render must wait. It fails with the gates removed
- [x] 4b.7 Offered on every model tile including one whose thumbnail is missing or errored
      (`useThumbnails.ts:230,238` → `Grid.tsx:97-98`) — a failed image is a case re-render
      exists for. Absent on dir and zip tiles (D6): container tiles are glyphs, not renders.
      **Done:** `applies: (entry) => entry.kind === 'model'` on both rows — never a function
      of the tile's state, which is what makes the errored case free. Tested through App with
      a cache that rejects (`thumbnailActions.test.tsx`): the tile has no image and the menu
      offers both. Containers offer three items, asserted there and in `entryMenu.test.tsx`.
      The read they resolve from is the **cache**, not `thumbs.get(path)`, for this exact
      reason: an errored tile carries no camera, and resolving from it would redraw a user's
      own orbit at the default

## 5. Verification

- [x] 5.1 `bun run typecheck` and `bun run test` pass across workspaces.
      **Green at Stage C:** client 357 tests / 38 files, server 123 / 5, typecheck clean in
      both workspaces, `openspec validate entry-context-menu` clean, and the archive dry run
      applies on a fresh copy
- [x] 5.2 Component tests: the menu opens on secondary click without orbiting; each item
      appears only for the kinds D6 lists; copy path works from both surfaces with one
      implementation; reveal navigates, marks, pushes history, and leaves the flat toggle
      alone; the mark does not survive a reload; re-render re-renders under the current
      settings from the stored camera, and reset framing discards the stored orientation,
      renders at what the model then resolves to, and moves where the viewer opens it.
      **Landed across three files.** `entryMenu.test.tsx` carries the menu, the per-kind
      lists (now six items on a model the index covers) and reveal; `viewerLayer.test.tsx`
      the second copy surface. The two thumbnail lines are Stage C's:
      `thumbnailCommands.test.ts` for what each command renders from and writes back — the
      three discard cases, the axis rules, the resume gate, the label round trip — and
      `thumbnailActions.test.tsx` for the halves that need the whole app: a failed tile still
      offers them, a similarity grid's poses reach them, and reset framing moves where the
      lightbox opens the model *within the session*
- [x] 5.2a Reducer unit tests for the subject, beside the existing ten-findings cases: a
      similarity view and a query view replace each other rather than coexisting; a similarity
      deep link waits, stands in nested, and fires once the index is ready, under the
      deferral's own provenance so a restored one replaces rather than pushes; `clearSubject`
      leaves both kinds of subject by one rule; a Back between two similarity views of one
      model at different paths re-asks rather than patching (4.0b).
      **Landed with 4.0** as `describe('the view has a subject')` in
      `client/test/searchReducer.test.ts` — all four, plus the empty-input delegation, the
      phrase-options-do-not-re-ask rule, the URL that names nothing it cannot read, the
      absent name-corpus offer, and 4.6b's empty-result gate. Six of them were falsified
      against broken code before being trusted. Box stays open only for whatever §4.1–4.6b
      add on top.
      **§4.1–4.7 added one**: *entering a similarity view empties the draft, and erasing text
      under one still dismisses* (D9's margin). Falsified against the un-cleared reducer
- [ ] 5.3 Manual E2E via Playwright MCP on the real library — note tiles respond only to
      PointerEvents, so the secondary press needs `button: 'right'`, and clipboard reads
      need permissions granted upfront or the call hangs on a prompt. Reveal a model from a
      deep-search result, confirm Back returns to the results; reveal a zip-resident model
      and confirm it lands inside the archive; find similar from a model, confirm the URL
      names it alone, share it into a second tab, and dismiss back to the listing.
      Requires the index server (`serve_api.py`, port 8077) — not started by `bun run dev`
