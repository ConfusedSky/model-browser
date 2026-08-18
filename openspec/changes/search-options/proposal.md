# Search Options

## Why

`search-matches-folder-names` widens deep search to match folder names, which is right for a library organised by artist and set — but it makes one rule serve two intents. Sometimes you want the set (`Sandy Dunes` → the folder), sometimes the part (`bracket` → the file), and a folder match pulls in everything beneath it, which is exactly what you want in the first case and noise in the second. The same view now answers both questions with one answer.

Two controls settle it: whether folder names participate in matching, and whether results show folders, models, or both.

Neither is a one-off. Someone who organises by set wants folder matching every time; someone hunting parts wants it off every time. So they are preferences — but they cannot be *only* preferences, because they change **which results exist**. A shared or bookmarked search that omitted them would reproduce a different set of models on the recipient's machine than the sender saw, which defeats the point of having search in the URL at all.

So they live in both places, deliberately: persisted per browser profile like the lighting mode and the AO toggle, *and* carried in the URL like `path`, `flat`, and `q`.

## What Changes

- **A folder-matching option**: whether the deep-search predicate considers a model's containing folders and archives, or only its own file name. On by default — the default `search-matches-folder-names` establishes.
- **A result-kind option**: folders only, models only, or both. Applied to what a search returns.
- **Both are sticky**: persisted per browser profile, so the next search uses the last-used settings, following the `lighting.ts` / `aoToggle.ts` pattern exactly.
- **Both are in the URL**: a copied search link reproduces the sender's results, not the recipient's preferences.
- **A link does not rewrite your settings**: options from a URL govern that session's searches; only touching a control writes to storage. Otherwise a link someone sends you silently reconfigures your app.
- **Changing an option acts immediately**: with a query committed, the folder-matching option re-issues the search (it is a server predicate) and the kind option applies to the results already on screen.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `file-search`: gains an **ADDED** requirement covering the two options — what they control, that they persist, and how changing one affects a committed search. Deliberately additive rather than a modification of *Deep name search*: `search-matches-folder-names` already modifies that requirement, and two active changes modifying one requirement collide at archive.
- `url-navigation`: the **The URL names the committed view** requirement currently says preference state SHALL stay out of the URL, naming the lighting mode and the AO preference. That has to admit an exception, with a line that holds: those preferences change how a model *looks*; search options change *which models are returned*. The first is a rendering choice, the second is part of the view's identity — which is what the URL is for.

## Impact

- `client/src/viewer/lighting.ts` / `aoToggle.ts` — the persistence pattern to follow, not to change.
- `client/src/lib/urlState.ts` — two more parameters in `UrlView`, its serializer, and its parser; the boot precedence in `App.tsx` gains the "URL governs, storage is not overwritten" rule.
- `client/src/App.tsx` — the controls, and re-issuing a committed search when the folder-matching option changes (the `toggleFlat` path is the precedent: it re-requests and commits).
- `server/src/listing.ts` — the folder-matching option reaches `listFlat` as a request parameter gating the predicate `search-matches-folder-names` introduces; the kind option can be applied client-side over entries that already carry `kind`.
- `/api/dir` — one additive query parameter.
- Ordering: **after `search-matches-folder-names`**, whose predicate this gates. It composes with `listing-tree-cache` without entering its key: that cache snapshots the *tree*, and both the query and the folder-matching option are filters applied over the snapshot, exactly as they are applied over a live walk. Keying on them would store a duplicate tree per setting and force a fresh cold walk — the ~32s case the cache exists to remove — every time the option is toggled.
