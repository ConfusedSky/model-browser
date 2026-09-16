/**
 * Everything the banner has no room for (`landing-page` D2) — a document, not a
 * view: sections with fixed `id`s, so `/about.html#credits` lands where a link
 * points.
 *
 * **Imports nothing from `viewer/`, `three/` or `App`**: one import drags
 * three.js into a bundle whose job is to draw a list of names (D8). Claims here
 * have been wrong while their citation was right — check the subject (D10).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CreditedKit } from "../../../shared/types";
import type { ApiClient } from "../api/client";
import { CREDIT_LINK_CLASS, hostLabel } from "../lib/credits";

const SOURCE_URL = "https://github.com/ConfusedSky/model-browser";

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

/** Answers the scroll position it left the reader at, `null` if it scrolled
 *  nothing. */
function scrollToFragment(): number | null {
  const id = window.location.hash.slice(1);
  if (id === "") return null;
  const target = document.getElementById(id);
  if (target === null) return null;
  target.scrollIntoView();
  // `scrollIntoView` with no argument is instant, so this is the position it
  // produced.
  return window.scrollY;
}

export default function AboutPage({ api }: { api: ApiClient }): ReactNode {
  // React renders the sections after the browser has already looked for the
  // fragment, so `#credits` opened cold lands at the top. Scrolled twice:
  // after mount, and again once the credits list gives the page its height.
  const [creditsSettled, setCreditsSettled] = useState(false);
  // Gates the second scroll: a reader who has since scrolled away must not be
  // yanked back.
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
    // The app's root grounds itself on its own top-level element; this document
    // has none, so without a ground of its own it draws light text on white.
    <main className="min-h-screen bg-zinc-950 text-zinc-200">
      <div className="mx-auto max-w-3xl p-6">
        {/* The way back, and the repository opposite it. */}
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

        {/* source: landing-page's proposal.md; deploy/demo/config.json. A tile
          here is a baked picture (`corpus-bake`), not a render — only the
          lightbox fetches a model. */}
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

        {/* The corpus repository is private and gets no link. */}
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

        {/* source: Grid's `onKeyDown` and `onMenuKey`, ViewerLayer's Escape
          handler, App's find binding. */}
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
              Alt+Up Arrow; goes up a folder, the same as the &uarr; button at
              the top left.
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

        {/* source: mini-classify's `src/pose.py` and `src/query.py` — **read
          those, not its write-ups**, which are stale on how the two votes
          combine and on what opens the arbiter. Pooling is selectable, so the
          copy names the default and the exception. */}
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

        {/* source: each example run against the deployment's own index — the copy
          names what each returned, so re-run the four rather than trusting it.
          Two traps: **two** kits name a vampire, and README.md's
          staff/broomstick examples do not reproduce on this index. */}
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

        {/* source: deploy/demo/config.json's `features`, and entryActions.ts for
          what each withholds. The Download action is unbuilt (D10). */}
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
              A model you turn stays turned while you are looking at it and no
              longer, where the desktop app would save the framing for everyone.
            </li>
            <li>
              Nothing here names the machine this runs on, so an explanation
              that would send you to fix something on it is replaced by a plain
              statement that a thing is unavailable.
            </li>
          </ul>
        </Section>

        {/* source: three/renderer.ts (one renderer app-wide, D2). */}
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

        {/* source: the corpus repository's metadata contract and NOTES.md;
          ViewerLayer's credit rows; `OverrideCredits`. */}
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

        {/* source: the corpus repository's convert.py and NOTES.md (private, so
          named and not linked). Tile names are two rules: `/api/dir` gives a
          kit a `displayName` and gives the models inside it none. No download
          action exists (D10). */}
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

        {/* source: the `model-browser:` keys read through lib/stored.ts, and
          api/localFramings.ts. The search options are the exception because
          they are not local: the tuning is posted with the query and written
          into the address bar. */}
        <Section id="privacy" title="Privacy">
          <p className="mb-2">
            There are no accounts and nothing to sign in to, and no analytics
            script runs on these pages. Whether you dismissed the introduction
            and the ambient-occlusion setting are kept in this browser&rsquo;s
            own storage; the server holds neither for you, and clearing this
            site&rsquo;s data is the whole of forgetting them. How you have
            turned a model is kept nowhere at all &mdash; not here, not on the
            server.
          </p>
          <p>
            Your search options are the exception, and they are one by design:
            they say which models a search returns, so the mode and the tuning
            travel with the query and are written into the address bar. A link
            you copy carries them, which is what makes the results you send
            someone the results they see.
          </p>
        </Section>

        {/* source: `library-overrides` — the rows are ViewerLayer's, field for
          field. */}
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

type CreditsState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; kits: readonly CreditedKit[] };

/** From the data the lightbox draws one kit's credits from, so the two cannot
 *  disagree. Ignore-on-stale: nothing runs server-side to stop. */
export function CreditsList({
  api,
  onSettled,
}: {
  api: ApiClient;
  /** The page re-does its fragment scroll then: the list is what gives the
   *  section its height. */
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
    // `onSettled` is a fresh arrow each render, and re-reading on it would
    // re-issue the request every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  if (state.kind === "loading") return <p>Loading…</p>;
  // A reader who came for the attribution needs to know the list is missing,
  // not why.
  if (state.kind === "failed") return <p>The credits could not be loaded.</p>;
  // The ordinary desktop case, where an empty `<ul>` would read as a bug.
  if (state.kits.length === 0) return <p>The store holds no credits.</p>;
  return (
    <ul className="space-y-2 text-sm">
      {state.kits.map((kit) => (
        <CreditLine key={kit.path} kit={kit} />
      ))}
    </ul>
  );
}

/** What a kit with no stored display name is called on its tile. */
function lastSegment(path: string): string {
  const parts = path.split("/").filter((p) => p !== "");
  return parts[parts.length - 1] ?? path;
}

/**
 * Not a boundary — this is operator data — but React renders a `javascript:`
 * URL as a live link and only warns. *Parsed* rather than prefix-matched: the
 * parser strips leading whitespace and control characters first.
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

/** The lightbox panel's fields and order (`credits-completion` D4). */
function CreditLine({ kit }: { kit: CreditedKit }): ReactNode {
  const { credits } = kit;
  // A field whose URL this page will not follow draws as one with no URL, a
  // shape the row already has.
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
            // Verbatim, not `hostLabel` of it: a refused URL usually has no
            // host to label, and a row showing nothing would hide the field a
            // reader came to check.
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
