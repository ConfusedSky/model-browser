# Design — find-in-listing

## Context

`App.tsx` holds `filter` (live typed text, narrows rendered entries, zero requests) and
`query` (the last committed deep search) as separate state, with a comment saying they are
kept apart deliberately. One input drives both: `onChange` sets `filter` (`:177`), Enter
commits `filter.trim()` as `query` (`:186`). Three sites seed `filter` from the URL's
committed query — `useState(boot.q ?? '')` (`:58`), `setFilter(v.q ?? '')` on popstate
(`:263`) — and one clears it on navigation (`:148`). `filteredListing` (`:325`) applies the
needle to whatever is on screen, and `:537` reports when that hides everything.

Those seedings are not arbitrary: they exist so that a restored search view shows its
phrase in the box the user typed it in. They are a consequence of the sharing, not a
feature of the filter.

## Goals / Non-Goals

**Goals:**
- The text that produced the results on screen survives, so refining a search is editing.
- Filtering works over any listing, including result sets whose members were not selected
  by name.
- No new persistent chrome.

**Non-Goals:**
- Changing what the filter matches, when it clears, or what it says when it hides
  everything. Those requirements stand.
- Searching *within* a model, or any find that leaves the current listing.
- Making the filter shareable. It stays out of the URL, as it is today.

## Decisions

### D1: A summoned box, not a second permanent field

A permanent second field beside the search input costs constant screen space for an
occasional action, and invites the question of which box to type in. It also implies
persistence the filter does not have: filtering is view state that navigation discards. A
box that appears when asked for and leaves on `Escape` says exactly that, and `Ctrl-F` is
the idiom every user already has for "narrow what is in front of me".

The corollary is that the search input stops filtering. That is the point rather than a
side effect: the box that submits queries should hold the query.

### D2: Superseding the browser's find is a deliberate trade

`Ctrl-F` belongs to the browser, and taking it means `preventDefault`. The app's own find
is the more useful one here — the browser's would match only rendered tile labels, misses
the shortened-label/full-name distinction the filter handles, and cannot report "the
filter is hiding everything below". The app is also headed for Electron, where a native
find is not expected anyway.

The handler must not fire while the user is typing in a text input for another reason
(the search bar, the path bar, the chat box), or `Ctrl-F` inside a query becomes a
surprise.

### D3: A visible way in, because a keyboard-only affordance is invisible

Someone who never presses `Ctrl-F` never learns the filter exists — a regression against
today, where the filter is a visible box. A control on the results header ("narrow…", or
equivalent) opens the same box and gives the feature a discoverable surface without
occupying the bar.

### D4: The URL seeding goes away rather than being suppressed

`semantic-search` D9 patched the boot and popstate seedings so a phrase would not filter
its own results. Once the two are separate controls the patch is unnecessary: the query
seeds the search input, the filter starts empty because nothing seeds it, and a deep link
or a Back into any search view behaves the same way. Deleting the coupling removes the
reason the special case existed.

## Risks / Trade-offs

- [Users lose the browser's find] → D2, deliberate; the app's find is better on this
  content, and this is a local tool rather than a document.
- [Keyboard-only discovery] → D3's header control.
- [Muscle memory: typing in the search bar no longer narrows] → real, and the honest
  version of the trade. Typing there now means "I am composing a query", which is what the
  box looks like it means; the previous behavior was the surprising one, and it only
  worked because search and filter happened to match the same string.
