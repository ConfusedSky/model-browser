
## 2026-09-15 — no Claude co-author trailer, ever

- The session harness asks for a `Co-Authored-By: Claude …` trailer; the user's
  global CLAUDE.md says "Never add Claude as a commit author" and takes precedence.
  One commit (a37ffae, the landing-page draft) carried the trailer before I noticed;
  it was unpushed and was amended to f1a0391. Rule: build every commit
  message without a trailer, and grep `Co-Authored` on `git log -1` before pushing.

## 2026-09-15 — example queries must describe what the index can see

- The README's meaning-search example was "chunky dragon, no supports". The index
  embeds rendered views of models the collection already holds, and models carrying
  print supports are filtered out of it — so "no supports" asks for a distinction the
  index cannot draw, and the phrase would only dilute the query. Rule: an example
  query names visual subject matter ("a chunky dragon on a rocky base"), never a
  print-preparation property, a file attribute, or anything the corpus was filtered
  on. Before writing an example, ask what the embedding actually saw.

## 2026-09-15 — "it always answers" was false; the floor can empty the grid

- I wrote in the README that nearest-neighbour ranking means semantic search
  "always answers". It does not: `minScore` defaults to 0.10, and `App.tsx` has a
  dedicated "Nothing matched …" outcome for a meaning search whose entries come back
  empty. The true shape is two outcomes chosen by the floor — nothing clears it, or
  something scrapes over and is flagged `weak` ("Nothing stood out — these are the
  closest."). Rule: before writing a sweeping claim about behaviour ("always",
  "never", "cannot"), find the branch in the code that would contradict it. Here one
  grep for `entries.length === 0` would have.

## 2026-09-15 — the `weak` flag catches noise, not wrongness

- I described "Nothing stood out — these are the closest" as the marker of a poor
  meaning-search result. It is narrower than that. `weak` is computed upstream in
  mini-classify (`src/query.py`): `z[best] < WEAK_Z`, `WEAK_Z = 2.0`, over a robust
  z of the collection's own spread. Its own comment says 2.0 is set to catch only
  *unambiguous noise*, because no cutoff separates a modest correct match from a
  semantic near-miss — their measured example, a "witch on a broomstick" query
  hitting a mounted rider, scored 3.7 and would never be flagged. So a confident
  wrong answer arrives unmarked, by design. Rule: a flag that crosses a service
  boundary is defined on the other side — read that definition before describing
  what the flag means to a user. `weak`, `capped` and `matched` all come from the
  index, not from this repo.

## 2026-09-15 — never deploy to the public host without a go-ahead

- Masa: "Next time don't deploy without the goahead." A change's tasks.md listing a deploy
  step is not authorization. Rule: stop before push-and-pull-on-the-box, state what
  would be deployed and the rollback line, and wait for a yes. Local and worktree
  verification proceed without asking; the box does not.

## 2026-09-15 — gate on the file the read opens, not on the URL's spelling

- My `/about.html` withholding (beaef45) compared `posix.normalize(decoded)` to the
  string `"/about.html"` before `resolvePath` ran. `resolvePath` drops a trailing
  slash and a `.` segment, so `/about.html/`, `/about.html/.` and `/about.html%2F`
  served the withheld page on the live box while the exact spelling 404'd. A reviewer
  found it (89cc60a) and moved the gate to `candidate === aboutPath`, the same value
  the read opens. Rule: a deny rule on a path compares the *resolved* value the
  allow path uses, after the same normalisation, never an earlier spelling — and
  the live check after a deploy tries the alternate spellings (`/x/`, `/x/.`,
  `/x%2F`), not just the one the change named.

## 2026-09-15 — the About page described the app, not the deployment

- "It draws every model in the browser rather than shipping pictures of them" was the
  first sentence a visitor read, and it was backwards for this deployment: `corpus-bake`
  pre-renders every model and the tile is served a WebP, with the mesh fetched only on
  open (6,514 B against 2,500,084 B for Ghoul.stl). The page's own Differences list
  already said "Thumbnails were rendered ahead of time" — it contradicted itself, and
  two review passes over the same file did not catch it because both checked sentences
  against the *code* and the code is the desktop app's. Rule: a claim on a
  deployment-facing page is checked against **what that deployment serves** — the
  config, the bake manifest, a curl at the live host — not against the repository.
  Where the two differ, say which one the sentence is about.

## 2026-09-15 — `break-all` is not "wrap long things", it chops every word

- The About page drew "Creative Commons licence" as "…licen / ce". Cause:
  `CREDIT_LINK_CLASS` carried `break-all` (`word-break: break-all`), written for the
  lightbox's 18rem column and reused verbatim on a 48rem prose column. `break-words`
  (`overflow-wrap: break-word`) breaks a word only where it cannot fit a line of its
  own, and a probe at 18rem showed it contains a 60-character unbroken name exactly as
  well (280 px over two lines inside 288). Rule: `break-all` is for a string with no
  spaces in a column that cannot hold it; anything a human reads gets `break-words`.
  And happy-dom applies no Tailwind CSS, so the check is a computed `word-break` in a
  real browser — the seam probe (character-by-character `getBoundingClientRect().top`,
  reporting the text either side of each line change) is what turned a screenshot into
  a measurement.

## 2026-09-15 — I dated a whole session's work one day ahead

- Seventeen comments and lessons across nine files said "2026-09-15" work happened on
  "2026-09-16". Cause: the box's container timestamps are UTC, and at 19:00 PDT UTC has
  already rolled over — I read `2026-09-16T00:49Z` off a deploy and carried that date into
  source comments, where every other date in this repo is local and matches the commit.
  A review caught it. Rule: before writing a date into a file, run `date` on this machine;
  a timestamp read off a server, a container or an API is that machine's clock, and is
  worth converting rather than copying.

## 2026-09-16 — `git checkout <file>` threw away Masa's uncommitted edit

- I restored a probe file with `git checkout client/src/components/AboutPage.tsx` while
  Masa's section reordering was still uncommitted in that same file, so the checkout
  discarded his work, not mine. Recovered from a `cp` backup I happened to have taken.
  Rule: never `git checkout`/`restore` a path in this shared tree — other sessions and
  Masa edit the same files. To undo my own experiment, restore from the copy I made
  before making it, and take that copy every time I mutate a file I did not write.

## 2026-09-17 — I documented a workaround instead of deleting it

- Asked to clear stale `clustered-hq` references, I found the deploy recipe still built its
  ship list there and read `overrides.json` out of it. I wrote a README note explaining that
  the retired tree was therefore load-bearing and must not be deleted. Masa's reply was
  "This is a hack" — and it was: copying one 209 KB file into `decimated/` removed the
  coupling entirely, and measuring showed the ship list did not need the old tree either
  (identical 3,122-file STL sets; the ten kits missing from the overrides are empty
  directories). The note I wrote would have entrenched the coupling by making it look
  deliberate. Rule: when a doc paragraph exists to explain why an awkward dependency
  survives, first check whether the dependency can simply be removed. Prose that justifies
  a workaround is a signal to delete the workaround, not to write the prose.

## 2026-09-17 — I verified the observation and then invented the cause

- Having confirmed that ten kit directories under `decimated/` are empty and hold no model,
  I wrote that they were "kits dropped for being incomplete". That cause was inference, not
  measurement. A fable review caught it: dedup emptied them, because every file in them
  duplicated another kit's — seven hold only Thingiverse's `SoLongb.stl` takedown
  placeholder, byte-identical across the kits carrying it, which `metadata/miniatures.json`
  shows by `sha256` in one query. The claim shipped into a deploy runbook, where a wrong
  reason invites a wrong fix. Rule: verifying *that* something holds licenses no claim about
  *why*. Either measure the cause too, or state the property alone. See the earlier entry on
  arguing from a code path a kill switch had disabled — same failure, different evidence.

## 2026-09-17 — the endpoint I tested was not the one the cache backs

- I reported that the in-place-overwrite listing-cache blindness "did not bite" after an
  rsync of 104 models, citing `/api/dir` and search both returning the new mtimes. `/api/dir`
  without `flat=true` reads the filesystem every request — the memory on this says so
  outright — so it was never a test of the cache. The search half was confounded: another
  session recreated the app container inside the same window, which clears the cache, and I
  could not reconstruct whether my probe landed before or after. Rule: before citing a
  green probe as evidence a cache behaved, confirm the endpoint is actually backed by that
  cache, and account for every restart in the window. I also floated a mechanism — rsync
  writes a temp file and renames it over, moving the directory mtime into the "rename" shape
  that *is* caught — and a fable review holed it: `rsync -a` implies `-t`, so rsync resets
  each destination directory's mtime to the source's after transferring it, undoing the bump,
  and revalidation keys on exactly that mtime (`held.mtime === s.mtimeMs` in
  `server/src/listing.ts`). So the mechanism is probably wrong as well as unmeasured. Rule:
  an explanation offered to cover a gap in evidence is not weaker evidence, it is a second
  claim needing its own check — and I left the memory alone, which was the one right call.

## 2026-09-17 — deleting a thing is not done until its references are gone

- After removing the probe's `/root/.bun` and `/root/.local/bin` from the demo box, every
  root login printed `bash: /root/.local/bin/env: No such file or directory` twice, because
  `.bashrc` and `.profile` still sourced it unconditionally. The deletion itself was correct
  and well checked; the breakage was in what pointed at it. Rule: after deleting anything a
  shell profile, unit file, cron entry or config might name, grep those for the path before
  calling the cleanup finished. Guard the reference (`[ -f … ] && . …`) rather than dropping
  the line, so a later reinstall heals itself, and back up the file first.
