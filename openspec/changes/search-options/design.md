# Design — search-options

## Context

The app already has three distinct homes for state, and this change needs a fourth that does not exist yet:

| | localStorage | URL |
|---|---|---|
| lighting mode, AO preference | yes (`lighting.ts`, `aoToggle.ts`) | no |
| path, flat, q, model | no | yes (`urlState.ts`) |
| live filter text | no | no |
| **search options** | **yes** | **yes** |

`flat` is URL-only — `useState(boot.flat)`, nothing persisted. The preference modules share one shape: a module-level IIFE reading `localStorage` inside a `try`, a getter, and a setter that writes back inside a `try`. `urlState.ts` owns parse/serialize/commit and is the only encoder (`URLSearchParams`, never a second pass).

`search-matches-folder-names` introduces the predicate this change gates; it is unimplemented at the time of writing.

## Goals / Non-Goals

**Goals:**
- One typed query, two intents — the set or the part — settled by an explicit control rather than by guessing.
- Settings that stick, without shared links reconfiguring anyone.
- A rule for "preference in the URL" that the next feature cannot stretch.

**Non-Goals:**
- Changing the default. Folder matching defaults on; `search-matches-folder-names` argued that and this change does not relitigate it.
- Fuzzy or multi-term matching, ranking, or a settings panel — these are two controls beside the existing pills.
- Putting the live filter text in the URL. It stays ephemeral (`url-navigation`).
- Server-side kind filtering (D3).

## Decisions

### D1: The line that lets a preference into the URL

`url-navigation` says preference state stays out of the URL, and that rule is load-bearing — without it the "committed view" grows without limit. The exception is stated so it cannot be stretched: **a preference belongs in the URL when it determines which entries the view contains, not how they are drawn.**

Lighting mode and the AO toggle change a model's appearance; two people looking at the same URL with different settings see the same models. Search options change the result set; without them in the URL, the same link yields different models for sender and recipient, which makes a shared search a lie. That is a difference in kind, not degree, and it is the whole justification.

### D2: Sticky *and* shareable, with the URL winning and storage untouched

On load, options from the URL govern — matching `url-navigation` D4's existing precedence, where the URL beats the localStorage last-path. They are **not** written to storage: a link from someone else must not silently reconfigure the app. Only operating a control persists.

The visible consequence, worth stating so it does not read as a bug: after opening someone's link and then navigating away and searching fresh, options snap back to yours. That is correct — the link governed the view it named, not your setup.

### D2a: Over a URL-named search, an absent option means the *default*

D4 omits options at their defaults so an ordinary search URL stays what it always
was. That only reproduces the sender's view if the recipient reads the omission the way
the sender wrote it — as *the default*, never as "my stored preference". Read the other
way, the two rules cancel: a sender whose options are default sends a URL carrying
nothing, and a recipient with non-default settings sees a different result set from the
same link, which is exactly what D1 says the URL exists to prevent.

The same reading fixes history. A restored entry is a past view, and restoring it under
present settings is the same bug wearing a different hat — worse, since the options are
part of what makes two entries different views, comparing entries without them left Back
changing the URL and nothing else.

Stored preferences therefore govern exactly one thing: a search this profile starts
fresh, where there is no view to reproduce. Leaving a link's view — navigating away —
puts them back in force.

### D3: The kind option is client-side; the matching option cannot be

Entries already carry `kind`, so restricting to folders or models is view state over the response — like the existing filter, and instant. Folder matching decides what the *walk* returns and must be a request parameter.

That asymmetry drives the behavior when a query is committed: the matching option re-issues the search (the `toggleFlat` path is the precedent — it re-requests, lands, and commits), while the kind option re-presents what is already there. Both are in the URL regardless: the kind option is a mode like `flat`, not typed text like `filter`.

One consequence to handle rather than discover: the server's caps bound what it returns *before* a client-side kind filter runs, so "models only" over a capped response shows the models within the cap, not the first N models overall. The truncation notice must keep describing the underlying listing — which is already what `file-search` requires of it for the live filter.

### D4: Two more parameters, one encoder

`UrlView` gains both options; `serializeView` omits them at their defaults, so an ordinary search URL is unchanged and no history entry appears merely because defaults were made explicit. `commitUrl`'s push-only-on-difference already prevents a no-op write. The `URLSearchParams`-only rule holds — a second encoding pass double-encodes, as `urlState.test.ts` pins.

### D5: Controls live in a search tab on the side panel, and the panel mirrors the search

A pill row was the obvious home and it does not scale to where search is going. Two options today become more as search grows a second corpus, and some of them are meaningless in some modes — a row that reflows as the user changes what they are searching is worse than a panel that simply shows different contents. A panel also has room for the things that currently have nowhere to go: what a search covers, how many models a scope holds, and eventually whether a second index is even answering. Those belong beside the controls, not squeezed into the sentence under an empty grid.

`chat-panel` already ships the container — a collapsible right-edge panel whose collapse state persists — so this adds a tab alongside chat rather than inventing a second drawer.

**The panel mirrors the committed search; it does not own it.** The search input stays in the bar, because search is the app's primary action and the panel is collapsible: a user who left it closed must not have to open a drawer to search. The frequency asymmetry decides it — you search constantly and tune options occasionally. So the panel reads back what is in force (the committed query, the options, what the results cover) and offers the controls, while the input and its results label stay with the grid they describe.

*Alternative — pills beside the input:* rejected above, and rejected now rather than later specifically because building the row and dismantling it two changes on is the expensive order.

*Alternative — move the search input into the panel too:* rejected. It divorces the input from the results label over the grid, and it puts the app's primary action behind a collapsed drawer.

## Risks / Trade-offs

- [A stored option silently changes what a later search returns, and the user has forgotten setting it] → the controls are visible and reflect state; this is the same bargain as the lighting mode, and it is why they are controls rather than hidden config.
- [The URL grows to six parameters] → each one names something that changes what is on screen, which is D1's test; the day a parameter fails that test it does not belong.
- [`search-matches-folder-names` is unimplemented, so this gates a predicate that does not exist] → hard ordering, declared in tasks; the option is meaningless until then.
- [Options must be part of `listing-tree-cache`'s key] → recorded in both changes; a cached walk computed under one predicate must not answer a request made under another.
- [Client-side kind filtering interacts with the caps] → D3; the truncation notice keeps describing the underlying listing, as it already must for the filter.
