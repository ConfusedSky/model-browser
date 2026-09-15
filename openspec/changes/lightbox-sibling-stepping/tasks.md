## 1. The sibling list and the step handler (App)

- [x] 1.1 `App.tsx`: `modelSiblings = useMemo(() => shownEntries.filter((e) => e.kind ===
      'model'), [shownEntries])`. Where `<ViewerLayer>` renders, resolve the current index by
      `viewer.entry.path`; derive `prevEntry` / `nextEntry` as the neighbour or `null`, and
      when the index is `-1` BOTH are `null` (D1 — no teleport to `siblings[0]`)
- [x] 1.2 `App.tsx`: `navigateSibling = useCallback((entry: DirEntry) => { if
      (viewerRef.current?.mode !== 'lightbox') return; setViewer((v) => v ? { ...v, entry,
      originEl: tileFor(entry.path) ?? v.originEl } : v); commit({ type: 'modelOpen', path:
      entry.path }, { replace: true, state: window.history.state }) }, [commit])` (D3/D4).
      `setViewer` runs BEFORE `commit` — carry a comment saying why (close-watcher's
      `namedModelRef` guard). `tileFor` finds a mounted tile by `data-entry-tile` for the
      path so a later close returns focus to the shown model (D4). Pass `onNavigate=
      navigateSibling`, `prevEntry`, `nextEntry` to `ViewerLayer`

## 2. Keys, affordances, persist-on-step, state reset (ViewerLayer)

- [x] 2.1 `ViewerLayer.tsx`: add `onNavigate`, `prevEntry`, `nextEntry` to `Props`; read all
      three, and `goTo`, through refs updated on render (NOT in the key effect's deps — D6)
- [x] 2.2 `ViewerLayer.tsx`: `async function goTo(entry)` — snapshot the current viewer
      (`const started = viewerRef.current`), run `closeLightbox`'s branch (`if
      (s?.everManipulated) { await s.settle(renderNow); await onPersist(s) }`), then bail if a
      close raced in (`if (viewerRef.current !== started || modeRef.current !== 'lightbox')
      return`) before `onNavigateRef.current(entry)` (D3). One handler; a key and a button
      both call it
- [x] 2.3 `ViewerLayer.tsx`: the session effect clears `setSession(null)` and
      `setLoadError(null)` at its top on an entry change, so a step draws a spinner and not
      the leaving model's frame or a stale error (D5)
- [x] 2.4 `ViewerLayer.tsx`: in the lightbox `onKey`, beside Escape/Tab, handle `ArrowLeft`
      → `goTo(prevEntryRef.current)` and `ArrowRight` → `goTo(nextEntryRef.current)` — return
      early on `altKey || ctrlKey || metaKey` (leave Alt+Arrow to the browser), guard on
      `menuOpen.current` as Escape does, `preventDefault`, and no-op when the target is
      `null`. Make the effect's `containerRef.current?.focus()` conditional on the dialog not
      already containing `document.activeElement` (D6). Deps stay `[viewer.mode, session]`
- [x] 2.5 `ViewerLayer.tsx`: render two arrow buttons as siblings of the canvas host inside
      the square viewer container — previous left, next right, absolutely positioned and
      centred, above the canvas, `type="button"`, `aria-label` "Previous model" / "Next
      model", `disabled` when the neighbour is `null` (D2); both call `goTo`. Confirm a click
      on either does not orbit/zoom (events bubble to the container, which has no orbit
      handler)

## 3. Tests

- [x] 3.1 `client/test/lightboxPrevNext.test.tsx` (new), harness `mountApp`, listing with
      several models plus an interleaved dir and zip:
      - open a middle model (`pressEnter` on its tile); `[role="dialog"]` present
      - `dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))` in `act` → dialog
        still present, its `aria-label`/heading names the next model, `location.search` names
        the next model path; `ArrowLeft` reverses
      - a model with an interleaved dir/zip between it and the next model steps straight to
        the next model (model-only, D1)
      - first model: `ArrowLeft` is a no-op (dialog unchanged, still open) and
        `[aria-label="Previous model"]` is present with `disabled`; last model likewise for
        next (D2)
      - `Alt+ArrowRight` does NOT step (modifier ignored, D6)
      - clicking the Next / Previous button matches the keys
      - after several steps the dialog is still present (never closes)
      - a step after an orbit calls `putThumb` for the LEAVING model's path, not the new one
        (D3) — assert on the harness's `putThumb` mock args; a step with no orbit calls it not
      - close-during-persist: orbit, hold `putThumb` on a `deferred()`, ArrowRight, `pop()` to
        close, then release the deferred → the dialog stays closed and `location.search`
        carries no `model` (D3)
      - a step to a model whose `fetchModel` is held shows the spinner and no stale frame; the
        axis group returns when it lands (D5)
      - `history.length` unchanged across a step (replace, D4); a `popstate` afterward still
        closes the lightbox (reuse `urlLightbox.test.tsx`'s `pop()`/`dialog()` helpers)
      - a close after stepping returns focus to the shown model's tile (D4)
      - Falsify: drop the `everManipulated` guard → the no-orbit step wrongly persists; change
        `replace` to a push → the history-length cell fails; drop the `goTo` snapshot bail →
        the close-during-persist cell re-opens

## 4. Land it

- [x] 4.1 `cd client && bunx vitest run` and `bun run typecheck` green
- [ ] 4.2 Manual on 5173 (not 3177 — it may serve a stale `dist/`): open a folder with
      several models, open one, ArrowLeft/ArrowRight and click both arrows — the lightbox
      steps without closing, interleaved non-models are skipped, the end controls are
      disabled, and `?model=` follows. Tab to the Next control and press Enter twice — it
      steps each time (focus is not yanked to the dialog, D6). Orbit a model, step away and
      back — the framing was saved. Close after stepping — focus lands on the shown model's
      tile
- [ ] 4.3 `openspec validate lightbox-sibling-stepping --strict`; archive dry run on a fresh
      copy; after archiving, confirm the applied `model-viewer` / `url-navigation` text
      carries no change-scoped prose
