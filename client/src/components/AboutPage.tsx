/**
 * The About page — everything the banner has no room for (`landing-page` D2,
 * `visitor-intro`).
 *
 * A document, not a view: no reducer, no history, no focus trap, one `<main>`
 * column of sections with fixed `id`s so `/about.html#credits` lands where the
 * banner's credits link points. The only dynamic part is `CreditsList`.
 *
 * **Imports nothing from `viewer/`, `three/`, `App` or any other component.**
 * `ViewerLayer` value-imports the renderer, so a single import from it would
 * drag three.js into a bundle whose job is to draw a list of names (D8) —
 * `hostLabel` and `CREDIT_LINK_CLASS` come from `lib/credits.ts` for exactly
 * that reason.
 *
 * **Every factual sentence below was checked against a named source (D10)**,
 * and each section's comment says which. The page states no accuracy figure
 * and names no location on the machine the server runs on: the first would
 * have to be re-run to stay true, the second is not the viewer's business
 * (`feature-report`). The four Limitations examples were run against the
 * deployed index; one that stops reproducing is removed rather than kept as
 * lore.
 *
 * Nine sentences here have been wrong anyway, and they shared a shape: each
 * was true of something *near* its own subject — of the desktop app rather
 * than this deployment, of a kit's tile rather than a model's, of the default
 * pooling rather than the one a reader can pick. **A correct citation is what
 * every one of them had.** So check a sentence's own subject against the code,
 * the corpus or a live route, never against the citation beside it.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CreditedKit } from "../../../shared/types";
import type { ApiClient } from "../api/client";
import { CREDIT_LINK_CLASS, hostLabel } from "../lib/credits";

/** The repository this is built from — public, `ConfusedSky/model-browser`. */
const SOURCE_URL = "https://github.com/ConfusedSky/model-browser";

/** A section's heading, with the `id` a link from elsewhere aims at. */
function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <section id={id} className="mt-8">
      <h2 className="mb-2 text-lg font-semibold text-zinc-100">{title}</h2>
      {children}
    </section>
  );
}

/** One link out of the page. External, so the same rules the credit links use. */
function Out({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}): ReactNode {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={href}
      className={CREDIT_LINK_CLASS}
    >
      {children}
    </a>
  );
}

/**
 * Bring the URL's fragment into view, answering the scroll position that left
 * the reader at — or `null` where there was no fragment, or no section by that
 * name, which the caller reads as "no scroll happened".
 */
function scrollToFragment(): number | null {
  const id = window.location.hash.slice(1);
  if (id === "") return null;
  const target = document.getElementById(id);
  if (target === null) return null;
  target.scrollIntoView();
  // `scrollIntoView` with no argument scrolls instantly, so this is already the
  // position it produced rather than the one it started from.
  return window.scrollY;
}

export default function AboutPage({ api }: { api: ApiClient }): ReactNode {
  // The document's sections exist only once React has rendered them, which is
  // after the browser has already looked for the URL's fragment and found
  // nothing — so a link to `#credits` opened cold landed at the top (found on
  // 5173, 2026-09-15). The page scrolls itself, twice: once after mount, and
  // again when the credits list settles — the section is the last on the page,
  // and while its list still says "Loading…" there is not enough document below
  // it for the browser to bring it to the top (measured: 2190 px scrolled, the
  // section still 758 px down). The second scroll, over the filled list, lands it.
  const [creditsSettled, setCreditsSettled] = useState(false);
  // Where the *first* scroll left the reader, and `null` while no first scroll
  // has happened. Both readings gate the second one, because the second scroll
  // is a correction of the first and not an event of its own: correcting a
  // reader who has since scrolled away yanks them back mid-sentence, and there
  // is nothing to correct at all for a reader who reached `#credits` by
  // clicking the in-page link — that navigation was the browser's, over a
  // document already laid out, and it needed no help from here.
  const landedAt = useRef<number | null>(null);
  useEffect(() => {
    landedAt.current = scrollToFragment();
  }, []);
  useEffect(() => {
    if (!creditsSettled) return;
    const at = landedAt.current;
    if (at === null || window.scrollY !== at) return;
    landedAt.current = scrollToFragment();
  }, [creditsSettled]);
  return (
    // The app's root sets the dark ground on its own top-level element rather
    // than on `body`, and this document has no such element — without a ground
    // of its own the page rendered light text on white (seen on 5174).
    <main className="min-h-screen bg-zinc-950 text-zinc-200">
      <div className="mx-auto max-w-3xl p-6">
        {/* The way back and the repository, one line, baseline-aligned. The banner
          carries neither — About is the header's, and the credits and the
          source are this page's, which is where a reader who wants them has
          arrived. The Links section lists the issue tracker and the contact,
          which are follow-ups to the repository, and not the repository
          itself. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <a href="/" className="text-sm text-sky-400 hover:underline">
            ← Back to the models
          </a>
          <span className="text-sm text-zinc-400">
            Source:{" "}
            <Out href={SOURCE_URL}>github.com/ConfusedSky/model-browser</Out>
          </span>
        </div>
        <h1 className="mt-4 text-2xl font-semibold text-zinc-100">
          About this demo
        </h1>

        {/* source: openspec/changes/landing-page/proposal.md (Why),
          deploy/demo/config.json (the library this deployment opens).

          **A tile here is a picture, not a render.** `corpus-bake` pre-renders
          every model, the listing annotates the entry a `hit`, and
          `useThumbnails` hands the tile `api.thumbImageUrl(...)`: no geometry
          is fetched. The browser draws a tile only where the bake does not
          answer (`stale` or `miss`), and draws the model in the lightbox, which
          is what `fetchModel`'s `/api/file` is for. Anything implying otherwise
          describes the desktop app over an unbaked library, and has been
          written here twice.

          Measured 2026-09-15 on the deployment, `/Ghoul_3466743/Ghoul.stl`:
          6,514 bytes from `/api/thumb/image?…&ao=on` against 2,500,084 from
          `/api/file` (both need the `mtime` a listing gives). One model's
          ratio, not a constant — hence "kilobytes, not megabytes" and no
          figure. "Every model" rests on the bake manifest's 3,122, an `ao` and
          a `noao` render each. */}
        <Section id="what" title="What this is">
          <p className="mb-2">
            A public demo of Model Browser, a viewer for a library of 3D-print
            models. It can search by what a model looks like instead of by what
            its file is called.
          </p>
          <p className="mb-2">
            The tiles are pictures. This deployment renders one for every model
            ahead of time and serves it, so a screen of them costs kilobytes
            rather than the megabytes the models themselves weigh. Open one and
            the mesh is sent to your browser and drawn with WebGL — that is the
            model you turn, and why turning it is smooth once it arrives.
          </p>
          <p>
            The library it opens here is a corpus of tabletop miniatures
            assembled for the demo. The same application runs over a private
            library on a desktop machine, which is what it was written for.
          </p>
        </Section>

        {/* source: the corpus repository's CLAUDE.md ("Metadata contract with
          model-browser", the licence-vocabulary rules) and NOTES.md; the
          lightbox's own credit rows in client/src/viewer/ViewerLayer.tsx;
          shared/types.ts `OverrideCredits`. */}
        <Section id="licence" title="Licence and provenance">
          <p className="mb-2">
            None of these models are mine. Each was published by its designer
            under a{" "}
            <Out href="https://creativecommons.org/licenses/">
              Creative Commons licence
            </Out>{" "}
            and is redistributed here on those terms. The licences differ from
            model to model, and each model&rsquo;s own is linked from its
            credits.
          </p>
          <p>
            Every model is credited where it is shown: open one and the panel
            beside it names the author, the licence — linked to the deed that
            carries its version — and the page the file came from, with a line
            saying what was done to this copy where the file served is not the
            author&rsquo;s own. The same credits for the whole corpus are{" "}
            <a href="#credits" className="text-sky-400 hover:underline">
              listed at the bottom of this page
            </a>
            .
          </p>
        </Section>

        {/* source: the corpus repository's convert.py (`decimate`, quadric
          decimation over a welded mesh, and `modified_phrase`), its CLAUDE.md
          layout table and NOTES.md; deploy/demo/config.json, whose root is the
          `decimated/` tree. The corpus repository is private, so it is named
          and not linked.

          Tile names are two rules, not one: `/api/dir` answers a **kit** a
          `displayName` and answers the models inside it none, and `Grid` draws
          `entry.displayName ?? baseName(entry.name)` — so a model tile is its
          file name, extension dropped. The override store has no per-file name
          to give it (`listCredits` and `/api/overrides` are kit-keyed).

          Nothing here offers a download (`grep -rai download client/src`;
          `entryActions.ts` has `copyPath` and no sibling), so the closing
          paragraph says what the file *is* rather than what you get. The
          Download action is backlog 1.6's and unbuilt (D10). */}
        <Section id="corpus" title="How the corpus was altered">
          <p className="mb-2">
            What is served here is not the designers&rsquo; files verbatim, and
            each model&rsquo;s credits say so in the corpus&rsquo;s own words:
          </p>
          <ul className="mb-2 list-disc space-y-1 pl-5">
            <li>
              Duplicates were removed. Publishers reuse meshes heavily, and
              geometry uploaded more than once is kept once.
            </li>
            <li>
              Only the meshes were kept; the other files that came with a kit
              are not here.
            </li>
            <li>
              Every mesh was re-exported as STL and reduced for display by
              quadric decimation, so a model arrives in a browser tab rather
              than in a slicer.
            </li>
            <li>
              A kit&rsquo;s own tile is named from the corpus&rsquo;s metadata
              rather than from its folder, so the folder{" "}
              <span className="break-words text-zinc-400">
                1_Treasure_Token_for_DD_or_Other_RPG_2615634
              </span>{" "}
              reads as “1&quot; Treasure Token for D&amp;D or Other RPG”. The
              models inside a kit keep their own file names, which are the
              designer&rsquo;s.
            </li>
          </ul>
          <p className="mb-2">
            So every model here is a display copy, reduced to be drawn in a
            browser tab and not to be printed. The designer&rsquo;s own file is
            where the source link in a model&rsquo;s credits leads; print from
            that.
          </p>
          <p>
            The scripts that fetched the models and the metadata that records
            their provenance live in a separate, private repository; this one
            holds the application.
          </p>
        </Section>

        {/* source: deploy/demo/config.json (`appLaunch`, `chatTab`,
          `thumbWrites`, `hostDetails`, `maintenance` all false) and the
          feature-report specification's requirements for each field;
          client/src/lib/entryActions.ts for the actions those fields withhold.
          Stated as what this deployment does rather than as a promised
          replacement: the Download action and the Copy-link label are backlog
          1.6's and have not been built. */}
        <Section id="differences" title="What differs from the desktop app">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Opening a model in a slicer or any other application is not
              offered here — that is a desktop action, and a server has
              nobody&rsquo;s desktop to open it on.
            </li>
            <li>
              Copying a model&rsquo;s path copies its place in this library, not
              a location on the machine serving it.
            </li>
            <li>
              Thumbnails were rendered ahead of time and are read-only: nothing
              you do writes anything back to the server.
            </li>
            <li>
              A model you turn is remembered in this browser alone, where the
              desktop app would save the framing for everyone.
            </li>
            <li>
              Nothing here names the machine this runs on, so an explanation
              that would send you to fix something on it is replaced by a plain
              statement that a thing is unavailable.
            </li>
          </ul>
        </Section>

        {/* source: client/src/components/Grid.tsx (the tile's `onKeyDown` —
          Enter and Space — and `onMenuKey`, which takes `ContextMenu` and
          Shift+F10), client/src/App.tsx's window keydown effect (Ctrl/Cmd+F and
          Alt+ArrowUp, and the ambient-occlusion pill at `fixed bottom-3 left-3`),
          client/src/lib/gesture.ts (`nativeMenuRequested`: a shifted secondary
          press is left to the browser) and ViewerLayer's Escape handler. */}
        <Section id="how-to" title="How to use it">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Drag a tile to turn the model; press and release without moving to
              open it.
            </li>
            <li>
              Enter or Space opens the model the keyboard is on, and Escape
              closes what is open.
            </li>
            <li>
              Ctrl+F — Cmd+F on a Mac — narrows the folder you are in by name.
              It is the one binding that replaces your browser&rsquo;s own find
              while you are here.
            </li>
            <li>
              Alt+&uarr; goes up a folder, the same as the &uarr; button at the
              top left.
            </li>
            <li>
              Shift+F10, or the menu key, opens a tile&rsquo;s actions;
              Shift+right-click goes past them to the browser&rsquo;s own menu.
            </li>
            <li>
              The ambient-occlusion toggle sits at the bottom left — turn it off
              if turning a model feels slow.
            </li>
          </ul>
        </Section>

        {/* source: `gh repo view ConfusedSky/model-browser` (PUBLIC) and
          `gh repo view ConfusedSky/model-browser-corpus` (PRIVATE, so it gets
          no link — see the provenance section above). The repository's own line
          moved to the head of the page on 2026-09-15 and is not repeated here. */}
        <Section id="links" title="Links">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Report a problem:{" "}
              <Out href={`${SOURCE_URL}/issues`}>the issue tracker</Out>
            </li>
            <li>
              Contact:{" "}
              <Out href="https://github.com/ConfusedSky">
                ConfusedSky on GitHub
              </Out>
            </li>
            <li>
              <a href="#credits" className="text-sky-400 hover:underline">
                Credits for every kit in the corpus
              </a>
            </li>
          </ul>
        </Section>

        {/* source: client/src/lib/stored.ts and the `model-browser:` preference
          keys read through it (`lib/intro.ts`, `viewer/aoToggle.ts`,
          `lib/searchOptions.ts`), plus `api/localFramings.ts`, where a framing
          goes on a deployment that refuses thumbnail writes; client/index.html
          and this page, neither of which loads a third-party script.

          The search options are called out because they are not local:
          `HttpApiClient.semanticSearch` posts `{ text, path, ...tuning }` and
          `lib/urlState.ts` writes the mode and the tuning into the address bar
          (D10). The other three claim only that the *server* keeps none of
          them, never that no request reflects one — the ambient-occlusion
          setting rides a thumbnail request as `&ao=off` (`thumbImageUrl`). */}
        <Section id="privacy" title="Privacy">
          <p className="mb-2">
            There are no accounts and nothing to sign in to, and no analytics
            script runs on these pages. Whether you dismissed the introduction,
            the ambient-occlusion setting and how you have turned each model are
            kept in this browser&rsquo;s own storage; the server holds none of
            them for you, and clearing this site&rsquo;s data is the whole of
            forgetting them.
          </p>
          <p>
            Your search options are the exception, and they are one by design:
            they say which models a search returns, so the mode and the tuning
            travel with the query and are written into the address bar. A link
            you copy carries them, which is what makes the results you send
            someone the results they see.
          </p>
        </Section>

        {/* source: client/src/three/renderer.ts (one WebGLRenderer app-wide) and
          the repository's own architecture notes; the README's description of
          running the server over a local library. */}
        <Section id="webgl" title="WebGL and the desktop build">
          <p className="mb-2">
            The models are drawn with WebGL. A browser or a machine without it
            will show these pages and the tiles, but no geometry.
          </p>
          <p>
            This is the same application you can run over your own library:
            point the server at a folder and it browses that instead, with the
            actions this deployment withholds restored. The{" "}
            <Out href={SOURCE_URL}>source</Out> is what you would build.
          </p>
        </Section>

        {/* source: CLAUDE.md at the repository root (Bun + Hono server,
          React/Vite/three.js client, one renderer) and server/src/app.ts; for
          the posing, mini-classify's `src/pose.py` and `src/query.py`
          themselves. **Its write-ups are stale on two points** —
          docs/learnings/2026-08-11-canonical-pose.md and
          docs/archive/superpowers/specs/2026-08-10-pose-pipeline-design.md
          describe the two votes as averaged and the arbiter as gated on
          geometry's own confidence. Neither holds (checked 2026-09-15):
          `combine_up` is `geo_weight(geo) * unit(geo) + unit(siglip)` with
          `geo_weight` = `min(1, best / ABS_SCORE_FLOOR) ** GEO_FLOOR_POWER`, so
          a mesh with no print base is nearly silenced rather than averaged in;
          and `needs_arbiter_margin` measures the *combined* vote's margin
          against `MARGIN_THRESHOLD`, its docstring recording that gating on
          geometry escalated models the ensemble already had right. Read the
          source, not the write-ups.

          No figure from either appears here: their tuned numbers are marked not
          to publish. The view count is likewise unstated — `views: 8` is what
          this machine's copy of the demo cache was built with, and the deployed
          index's parameters cannot be read from here (ask its `/status`).
          Whether the third tier is on for the served poses is unstated for the
          same reason: `pose.py` records production running `--pose-vlm off`,
          while this machine's copy of the pose cache carries 597 of 3321
          entries at `source: "vlm"`, and the deployed copy cannot be counted
          from here. What is stated is what the tier does and what asks for it.

          Two claims to keep honest. Pooling is **selectable**: `POOLS` is
          `mean | max | softmax` and `pool_sims` for `max` is
          `view_sims.max(axis)`, one view deciding — so the copy names the
          default and the exception. And a tile here is a baked picture (see the
          "What this is" comment), so the one renderer draws the viewer and the
          tiles the bake misses, not the grid.

          "Pose" is defined at its first use because the interface never says
          the word: the pair a record holds, `up` and a `front` of view, azimuth
          and elevation — what `poseKey` spells (`-y:4.7124:0.3491`). */}
        <Section id="technical" title="Under the hood">
          <p className="mb-2">
            The server is Bun and Hono; the client is React and three.js, with
            one WebGL renderer for the whole page — it draws the viewer, and any
            tile the pre-rendered set does not already answer for. Meaning
            search is a separate service holding SigLIP embeddings of each model
            as seen from several angles, so a typed phrase and a picture of a
            model are compared in one embedding space — which is why a
            description finds things whose file names say nothing. A
            model&rsquo;s score for a phrase is pooled from all of its views by
            default, rather than read off one of them — the search options can
            ask for its single best view instead.
          </p>
          <p className="mb-2">
            Before a model is drawn at all, something has to settle which way up
            it stands and which side of it faces you. That pair is its pose, and
            finding it is the harder half of this and the invisible one: a
            library of miniatures lying on their sides is unreadable, and
            nothing in an STL says which way is up. Three tiers decide the up.
            The first is geometry — how much of the mesh rests flat on each
            candidate base, with the runner-up&rsquo;s score against the best
            standing for confidence. The second renders the model under each of
            six candidate ups and scores those renders against text prompts for
            upright and toppled; it runs on every model, and its scores are
            added to geometry&rsquo;s with geometry&rsquo;s turned down in
            proportion to how much flat base it found. A figure with none at all
            — leaping, flying, based on a rock — is where geometry is
            confidently wrong, and turning it down is how the pictures get to
            overrule it there. The third tier asks a vision-language model, and
            it is asked only where the first two together came out close: what
            opens that gate is how narrowly the combined vote won, not how sure
            the geometry was.
          </p>
          <p>
            The front view is chosen the same way, by scoring the model&rsquo;s
            own views against front and back prompts in that same embedding
            space, so it costs no extra render. The pose is kept as data rather
            than baked into the file, which is why the listings, the folder
            contact sheets and the search results all stand a model up the same
            way — and why turning one yourself overrides the pose without
            discarding it.
          </p>
        </Section>

        {/* source: each example run against this deployment's own index on
          2026-09-15, with the body a visitor's search sends
          (`{"raw":false,"pool":"softmax","top":60,"minScore":0.1}`). First five
          entries in order, and the flags returned:

          "a bicycle" — 0 entries, `matched: 0`. Nothing cleared the 0.10 floor,
          and App renders `Nothing matched` (`emptyNotice`'s
          `searchHasNoMatches` branch).

          "a submarine" — 31 entries, `weak: false`. Giant_Mimic, Quiver,
          miniature_sewing_machine, Longboat, Mini_Borderlands_Loot_Chest/lid.
          Its best hit stood at z 3.55 against `WEAK_Z` 2.0 (`src/query.py`),
          which is why no "Nothing stood out" notice: the flag is a robust z of
          the best score over the collection's spread, set to catch unambiguous
          noise only.

          "a vampire" — 60 entries, `matched: 405`. Jim_Darkmagic, The_REAL_Jim_
          Darkmagic, Zombie_NEW, MadMageFigure, ElfArmoredMage; then
          Half_Elf_Rogue, KindleCleric_000, Zombie_pose_3, Elf_with_the_stand,
          Zombie_Female_Pose_1. No drow in the first ten — `Drow_Rouge` is 11th,
          `Drow_Elite_Warrior` 12th. Strahd 18th, first ghoul 23rd.

          "an elf carrying an orb" — 60 entries. Elven_mage,
          Female_Halfling_Sorceress, Female_Ogre_BODY_AND_STAND,
          Human_Male_Warlock_with_Orb, Mage.

          Three traps this section has already sprung:

          — **Two kits name a vampire**, not one: `find <corpus root> -maxdepth
          1 -iname '*vamp*'` answers Strahd and Ancient_Vampire_Lord_UPDATED_
          511925. The second's rank is unrecorded, so the copy says only what
          the run shows.

          — **No sweep of these queries exists**, so no claim about a *tendency*
          ("full matches lead, partial ones trail") can be made from one run —
          this run's own third entry matches neither half of its phrase.

          — README.md's "wizard with a staff → orc shaman" and "witch on a
          broomstick → mounted rider" are mini-classify's measurements on its
          own collection and do NOT reproduce here (this index answers
          Gnome_Mage and Bard_on_a__Broom first).

          Re-run them before trusting this section again; an example that stops
          reproducing is dropped, not reworded. */}
        <Section id="limitations" title="What the search does badly">
          <p className="mb-2">
            Meaning search returns the nearest things to what you described, and
            nearest is not the same as right. It ranks; it does not judge. Four
            ways that shows, each one run against this deployment&rsquo;s own
            index:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="font-semibold text-zinc-100">
                Nothing clears the floor.
              </span>{" "}
              A meaning search keeps only hits above a score floor, so a query
              this corpus has nothing for can come back empty: ask for{" "}
              <em>a bicycle</em> and the page says nothing matched. That is the
              search declining to guess, not an empty folder.
            </li>
            <li>
              <span className="font-semibold text-zinc-100">
                A concept the corpus barely holds.
              </span>{" "}
              Ask for <em>a submarine</em> and the first screen is a treasure
              mimic, a quiver, a keyring sewing machine and a longboat —
              hull-shaped and box-shaped things, because there is no submarine
              here to find. What comes back is whatever was least far away, and
              it arrives without the &ldquo;Nothing stood out — these are the
              closest&rdquo; notice: that notice measures how far the best hit
              stands above the collection&rsquo;s own spread and fires only for
              unambiguous noise. A confident wrong answer like this one clears
              it unmarked.
            </li>
            <li>
              <span className="font-semibold text-zinc-100">
                Neighbouring concepts blur.
              </span>{" "}
              Ask for <em>a vampire</em> and the list opens with robed
              spellcasters, zombies and elves — with neither of the two kits
              whose names actually say <em>vampire</em> among them. The drow
              follow those, one of the vampire kits sits well down the list, and
              the first ghoul further down still. Each of the things above them
              is a fair reading of part of what a vampire is — undead, sinister,
              caped — and the search cannot pull them apart.
            </li>
            <li>
              <span className="font-semibold text-zinc-100">
                Part of a query counts as a match.
              </span>{" "}
              Ask for <em>an elf carrying an orb</em> and the first five are an
              elven mage, a halfling sorceress, an ogre, a human warlock holding
              an orb, and another mage. One score for a whole phrase cannot
              insist on both halves of it at once, so a figure that is neither
              an elf nor holding anything can outrank the one hit whose name
              says it carries an orb.
            </li>
          </ul>
        </Section>

        {/* source: the `visitor-intro` requirement "The credits list is every kit
          the store credits" and `library-overrides`' "The store's credits are
          listable"; the row markup is ViewerLayer's, field for field. */}
        <Section id="credits" title="Credits">
          <p className="mb-2">
            Every model is credited in the panel beside it when you open it in
            the browser. This list is the same credits for the whole corpus in
            one place.
          </p>
          <CreditsList api={api} onSettled={() => setCreditsSettled(true)} />
        </Section>
      </div>
    </main>
  );
}

/** What the credits section is showing right now. */
type CreditsState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; kits: readonly CreditedKit[] };

/**
 * The one dynamic part of the page: every credited kit the deployment's store
 * holds, drawn from the same data the lightbox draws a single kit's credits
 * from, so the two cannot disagree (`library-overrides`).
 *
 * Ignore-on-stale rather than an abort, like the panel's own overrides read:
 * there is nothing running server-side to stop, and the only thing that can
 * supersede this read is the page going away.
 */
export function CreditsList({
  api,
  onSettled,
}: {
  api: ApiClient;
  /** Called once the read has answered either way — the page re-does its
   *  fragment scroll then, because the list is what gives the section height. */
  onSettled?: () => void;
}): ReactNode {
  const [state, setState] = useState<CreditsState>({ kind: "loading" });
  useEffect(() => {
    let ignore = false;
    api.credits().then(
      (kits) => {
        if (ignore) return;
        setState({ kind: "ready", kits });
        onSettled?.();
      },
      () => {
        if (ignore) return;
        setState({ kind: "failed" });
        onSettled?.();
      },
    );
    return () => {
      ignore = true;
    };
    // `onSettled` is a fresh arrow each render of the page; re-reading on it
    // would re-issue the request every render, which is the ignore-on-stale
    // idiom's one hazard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  if (state.kind === "loading") return <p>Loading…</p>;
  // Said plainly rather than shown as a failed request: a reader who came here
  // for the attribution needs to know the list is missing, not why.
  if (state.kind === "failed") return <p>The credits could not be loaded.</p>;
  // A deployment with no override store is the ordinary desktop case, and an
  // empty `<ul>` would read as a bug — the requirement is to say so.
  if (state.kits.length === 0) return <p>The store holds no credits.</p>;
  return (
    <ul className="space-y-2 text-sm">
      {state.kits.map((kit) => (
        <CreditLine key={kit.path} kit={kit} />
      ))}
    </ul>
  );
}

/** The last segment of a library path — the kit's own folder name, which is
 *  what a kit with no stored display name is called on its tile. */
function lastSegment(path: string): string {
  const parts = path.split("/").filter((p) => p !== "");
  return parts[parts.length - 1] ?? path;
}

/**
 * A stored URL fit to be an `href`, or `undefined` where it is not.
 *
 * Depth rather than a boundary: the credits store is operator data — the
 * corpus's own metadata, written by whoever runs the deployment — so nothing
 * here is defending against a visitor. It is worth the handful of lines because React
 * does not close this by itself: a `javascript:` URL in an `href` renders as a
 * live link and React only warns in the console, so one bad row would be a
 * script every reader of this page could click.
 *
 * Absolute `http:`/`https:` only, and *parsed* rather than prefix-matched: the
 * URL parser strips leading whitespace and embedded control characters before
 * it decides the scheme, so a string a `startsWith` check reads as relative can
 * still navigate as `javascript:`. Anything refused keeps its text and loses
 * only its link — `hostLabel` already draws an unparseable URL verbatim for the
 * same reason, that attribution must not go quiet on a malformed field.
 */
function safeHref(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One kit's line. The fields, their order and their link rules are the
 * lightbox panel's rows (`credits-completion` D4: author, licence, source,
 * then what was done to this copy), reproduced here as one line rather than as
 * a description list because a page of them is a list of kits, not a
 * description of one.
 */
function CreditLine({ kit }: { kit: CreditedKit }): ReactNode {
  const { credits } = kit;
  // Each link's `href` decided once, before the row is drawn: a field with a
  // URL this page will not follow is drawn exactly as a field with no URL at
  // all, which is a shape the row already has.
  const authorHref = safeHref(credits.authorUrl);
  const licenseHref = safeHref(credits.licenseUrl);
  const sourceHref = safeHref(credits.sourceUrl);
  return (
    <li>
      <span className="font-semibold text-zinc-100">
        {kit.name ?? lastSegment(kit.path)}
      </span>
      {credits.author !== undefined && (
        <span data-credit="author">
          {" by "}
          {authorHref !== undefined ? (
            <a
              href={authorHref}
              target="_blank"
              rel="noreferrer"
              title={authorHref}
              className={CREDIT_LINK_CLASS}
            >
              {credits.author}
            </a>
          ) : (
            credits.author
          )}
        </span>
      )}
      {credits.license !== undefined && (
        <span data-credit="license">
          {" · "}
          {/* The label stays the corpus's own string and the deed URL carries
              the version; nothing here is derived from the label. */}
          {licenseHref !== undefined ? (
            <a
              href={licenseHref}
              target="_blank"
              rel="noreferrer"
              title={licenseHref}
              className={CREDIT_LINK_CLASS}
            >
              {credits.license}
            </a>
          ) : (
            credits.license
          )}
        </span>
      )}
      {credits.sourceUrl !== undefined && (
        <span data-credit="source">
          {" · "}
          {sourceHref !== undefined ? (
            <a
              href={sourceHref}
              target="_blank"
              rel="noreferrer"
              title={sourceHref}
              className={CREDIT_LINK_CLASS}
            >
              {hostLabel(sourceHref)}
            </a>
          ) : (
            // The stored string verbatim, not `hostLabel` of it: a refused URL
            // is usually one with no host to label — `javascript:…` parses
            // perfectly well and has an empty `host` — and a row that showed
            // nothing would hide the very field a reader came here to check.
            credits.sourceUrl
          )}
        </span>
      )}
      {credits.modified !== undefined && (
        <span data-credit="modified" className="text-zinc-400">
          {" · this copy: "}
          {credits.modified}
        </span>
      )}
    </li>
  );
}
