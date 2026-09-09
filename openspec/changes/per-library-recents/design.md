## Context

`client/src/lib/recents.ts` holds two keys — `model-browser:recents:v2` (the list the path
bar offers on focus) and `model-browser:last-path:v2` (written, read by nothing, kept
because the record cannot be reconstructed afterwards). Neither names a library. The
values are library-relative paths, which are only meaningful inside the library they were
recorded in, so an installation repointed at a second library — a `MODEL_BROWSER_ROOT`
change, a config edit and restart, a demo corpus swapped in beside the real one — offers
paths that library does not have. `PathBar`'s `onFocus` lists them and the click lands on
a not-found.

The neighbouring store already solved this. `api/localFramings.ts`'s `framingKey` puts the
library id in front of the path, and its comment gives the reason in the same terms: the
server's thumbnail cache is keyed by library id, and a personal installation repointed
between two libraries that share relative paths would otherwise read one library's data
onto the other's. Recents were simply not revisited when that landed.

Constraints: this is browser-local storage, so there is no wire or cache change and no
server involvement; `App` already derives `libraryId` from `LibraryState` for the framing
overlay, so the value is on hand; and the module's standing rule is that a read which
cannot happen reads as empty and a write which cannot happen is dropped.

## Goals / Non-Goals

**Goals:**

- One recents list per library, with no library able to read another's.
- Follow `framingKey` rather than invent a second scoping scheme for the same problem.
- Leave the path bar's behaviour otherwise exactly as it is: focus offers recents, typing
  switches to completions.

**Non-Goals:**

- Reopening where the last session ended. `LAST_KEY` stays written and unread (library
  D2/D7: the boot view is the library's top). It is keyed like the list because a value
  filed under no library is a value a later reader cannot use.
- Migrating existing entries into a library.
- Any change to `getRecents`' cap (`MAX = 10`) or ordering, which are per list and stay so.
- The two adjacent surfaces that also hold paths and are deliberately untouched: `trail.ts`
  (sessionStorage, per tab, keyed by history index — it never *offers* a path, and
  `placement.ts`'s `present()` drops an absent anchor to the top), and the URL, which
  carries a library-relative path across a repoint by design (url-navigation: the URL names
  the view).

## Decisions

**D1 — Key by the library id, not the library top.** `model-browser:recents:v2:<id>`,
matching `mb:framing:<id>:<path>`. The id is the marker's, so a library keeps its recents
across a remount at a different mountpoint — the case that motivated the marker in the
first place, a library on removable media. For an unmarked library the id is already a hash
of the top, which puts location back in the identity; that is the same trade the thumbnail
cache takes and there is no reason for this store to answer it differently. Keying by
`top` directly was the alternative: it needs no `ready` state to read, but it loses the
recents of every library whose mountpoint moves, which is the common case here.

**D2 — No key while the id is unknown, and the boot landing waits rather than being
dropped.** `framingKey`'s null rule is the read side and is taken whole: no id, no key, a
read answers `[]` and a write is dropped. The rejected alternative for reads is a shared
"unknown" bucket, which re-creates the bug this change removes — the first library to boot
would seed a list every other library then reads.

The write side needs one thing more, because "no landing worth recording happens before
the id arrives" is false. The three boot requests race: `App` issues the library probe and
the boot listing concurrently, and the framing overlay's own comment records the
consequence — "a listing that lands before `/api/library` seeds its tiles while
`framingKey` has no id". A deep-linked boot (`/?path=/Kit/sub`) can therefore reach
`pushRecent` with no id, and that directory is recorded today. Dropping it would be a
regression, small but real, so the landing is **held in one slot and flushed** when the id
arrives — the shape the overlay already uses: fire when the *last* of the two arrives,
which for the overlay is an effect on `[features, libraryId]` and here is an effect on
`libraryId` alone. One slot, not a queue: only the boot landing can be in this position,
since every later landing has an id behind it, and a second unrecorded path would mean the
id never came at all. A flush finding no id does nothing and keeps holding.

**D3 — The unkeyed entries are abandoned, not migrated and not deleted.** They cannot be
migrated: an unkeyed entry belongs to whichever library was open when it was written and
nothing recorded which, so any assignment is a guess that produces exactly the not-found
this change exists to remove. They are not deleted either. The sweep is
available — `main.tsx` already removes two retired orbit keys inside a `try`/`catch`, so
the safe form exists in this repo and "it might throw" is not the reason — but it buys
nothing a dead key does not already cost, and it spends a write on every boot forever to
tidy something no code path reads. This is the call `recents.ts` made once already when it re-keyed to
`:v2`; the module's header comment says so, and gains a line for this round.

**D4 — The id reaches `PathBar` as a prop.** `App` renders the bar and already holds
`libraryId`; a prop is one argument through one call site. The alternatives were a React
context (a provider for one string read in one component) and having `recents.ts` read a
module-level ref that `App` assigns (which hides a dependency the type system would
otherwise state, and makes the store untestable without a global).

**D5 — `pushRecent`'s writes are wrapped.** `getRecents` already catches; `pushRecent`'s
two `setItem` calls do not, and it is called from inside the landing (`App`'s `land`), so
a profile that refuses site data throws in the navigation path rather than dropping a
convenience. What that throw costs is worse than a lost record: `land` is the first
argument of a two-argument `.then(land, fail)`, so a throw inside it is an unhandled
rejection that never reaches `fail` — neither a `landing` nor a `failure` is dispatched,
and the request stays inflight with nothing on screen saying why. The module's own doc
claims the degrade; this makes both halves keep it.

**D6 — The id is as fresh as the probe, and a repoint under an open tab shows on reload.**
`probeLibrary` runs at boot, on a path route's 503 that names a library state, and from
`navigate` only while the library is not `ready`. A drive remounted elsewhere is therefore
picked up live — the server answers `missing`, the client re-probes, the new id arrives —
which is the case D1 is about. A *server restart* on a different root is not: the requests
in the gap fail with a connection error carrying no state field, and once the new server is
`ready` nothing re-asks, so the tab keeps the old id and would file the new library's paths
under the old library's key until the page is reloaded. This is the framing store's
behaviour too, for the same reason, and it is left alone here rather than fixed by adding a
re-probe on a bare connection failure: that would put a probe behind every transient
network error for a value that is constant across a server's life. The manual verification
reloads.

## Risks / Trade-offs

- [An unmarked library that is remounted elsewhere gets a fresh id and so an empty recents
  list] → Accepted, and consistent: the server's thumbnail cache treats that as a
  different library too, so recents and thumbnails go cold together rather than one
  outliving the other confusingly.
- [Existing users lose their recents once, at first run after this lands] → The list is a
  convenience that refills in a session's worth of browsing, and the alternative (D3) is
  offering paths that error.
- [Dead unkeyed keys linger in every profile] → Named in the module header so the next
  reader of devtools storage knows what they are and that nothing reads them.
