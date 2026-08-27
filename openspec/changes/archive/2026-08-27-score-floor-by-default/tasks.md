> Landed in `de264a3`, before this change was written: the flip was a small code change
> whose reasoning is worth keeping, not a plan to work through. Boxes reflect what that
> commit did.

## 1. The default and its seed

- [x] 1.1 `TUNING_DEFAULTS` (`client/src/lib/searchOptions.ts`) carries `minScore: 0.1`,
      commented with the measurement it comes from rather than left as a bare number (D1).
- [x] 1.2 The `score ≥` control seeds the same 0.1 it defaults to (`SidePanel`), so the
      control has one resting place.
- [x] 1.3 `Tuning`'s doc records that an absent floor is the *count in force*, never "unset".

## 2. The URL inversion

- [x] 2.1 `parseUrl` selects the count on a bare `top`, clearing the floor explicitly so the
      resolution's spread over the defaults cannot leave it in force (D2).
- [x] 2.2 `serializeView` names the count whenever it is in force, including at 60, and names
      the floor only off 0.1.
- [x] 2.3 `client/test/urlState.test.ts` and `client/test/searchReducer.test.ts` express the
      count as a cleared floor — a view left at `{ ...TUNING_DEFAULTS, top: 12 }` is a floor
      with an inert count, and both suites pinned the old reading. **Corrected scope:** this
      originally claimed both suites were swept; what was actually done was fixing the two
      fixtures that *failed*. A fixture whose premise the flip had killed but whose assertions
      still passed — `searchReducer`'s "tuning survives the restore compare" — survived until
      review, and is fixed in 5.4. The other three `top:`-bearing fixtures were re-read and are
      sound: two are similarity views, which serialize no tuning at all, and the third pins
      preference re-seeding rather than URL visibility.

## 5. Found by review

- [x] 5.1 **HIGH — closing a lightbox flipped a floor-bounded search to a count.**
      `serializeView`'s count branch tested that a tuning object *existed*, not that it named a
      bound, so `?…&mode=meaning&pool=mean` — whose parsed tuning is `{pool:'mean'}` — was
      written back with `top=60`, which reads as the count in force with the floor cleared. The
      three `parseUrl()` → `commitUrl(…, {replace:true})` sites in `App` re-serialize a parsed
      URL, so closing a lightbox rewrote the address bar and nothing corrected it afterwards.
      Gated on `'minScore' in view.tuning` — the key's presence is the assertion, since the
      count's sentinel is `undefined`. The same asymmetry made `sameView` compare unequal
      against the URL the app was already on, pushing a dead history entry.
- [x] 5.2 **A stored count could not be told from a profile older than the field** — `null` on
      the way out, default on a missing key (D3).
- [x] 5.3 **`sameQuestion` compared an inert count**, so a restore across a `top` the index
      ignores beneath a floor re-asked and refetched a set already on screen.
- [x] 5.4 The `retuned` fixture in `searchReducer`'s "tuning survives the restore compare" is
      count-bound, so the two views genuinely differ; at `{ ...TUNING_DEFAULTS, top: 12 }` they
      serialized identically and the test pinned nothing.
- [x] 5.5 Every fix above falsified by reverting it and watching its own test fail. The first
      attempt at 5.2's falsification reverted the *writer* against a test that exercises only
      the *reader*, and passed — the vacuous check caught, then split into two.
- [x] 5.6 The delta's second paragraph reworded so that naming the count in a URL reads as the
      existing requirement's "carried when it is not its default" rather than as an exception
      to it: the bound is one option, and the count is its non-default value.

## 3. Storage and the panel

- [x] 3.1 The stored-profile reader keeps absence meaning the count, commented against the
      URL's opposite rule (D3).
- [x] 3.2 `SidePanel`'s reset affordance compares `minScore` to the default rather than to
      `undefined`, or it shows as modified at the defaults.

## 4. Close it out

- [x] 4.1 `bun run typecheck` clean; client suite 461 passing.
- [x] 4.2 Measured against the running index (97 models, `embed-cache-test`) through
      `/api/semantic`: 1–10 results for an ordinary phrase, 21–24 for a deliberately generic
      one, against sixty-with-a-0.003-tail under the old count. The feared "admits nearly
      everything" does not happen — 0.1 is near the top of the distribution, not its centre.
      Recorded in design.md D1.
- [x] 4.2a Measured against the library itself — `embed-cache512`, **3380 models**, mounted at
      `/run/media/masa/STLLibrary`. Specific phrases are floor-bounded at 69–177 tiles; generic
      ones cap at 500. The notice renders correctly ("The index returned fewer than asked for —
      its cap."). Where it caps it is a **wall**: `fantasy character` has 875 models above the
      floor and the 500th tile still reads k 0.122 against a first tile of k 0.146. A floor
      sweep shows no value that spares specific phrases while holding generic ones under the
      cap, so 0.1 stands. All recorded in design.md D1.
- [ ] 4.2b Re-measure the 500-tile sweep once `thumbnail-sweep-priority` lands: ~1.07
      thumbnails/s here means such a grid fills for minutes, and prioritising visible tiles is
      exactly what makes a capped set usable rather than merely correct.
- [x] 4.3 Archive with a dry run first. This change ADDs a requirement and MODIFIES none, so it
      cannot collide with `confidence-scores-on-tiles`, which MODIFIES "Weak matches are shown
      and marked" in the same capability.
