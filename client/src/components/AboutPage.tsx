/**
 * Everything the banner has no room for (`landing-page` D2) — a document, not a
 * view: sections with fixed `id`s, so `/about.html#credits` lands where a link
 * points.
 *
 * **Imports nothing from `viewer/`, `three/` or `App`**: one import drags
 * three.js into a bundle whose job is to draw a list of names (D8). Claims here
 * have been wrong while their citation was right — check the subject (D10).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CreditedKit, FeatureReport } from "../../../shared/types";
import type { ApiClient } from "../api/client";
import { CREDIT_LINK_CLASS, hostLabel } from "../lib/credits";
import Icon from "./Icon";

const SOURCE_URL = "https://github.com/ConfusedSky/model-browser";

/** In page order. The index and the headings both read this, so a section
 *  cannot be retitled in one and not the other. */
const SECTIONS = [
  ["what", "What this is"],
  ["links", "Links"],
  ["how-to", "How to use it"],
  ["technical", "Under the hood"],
  ["limitations", "What the search does badly"],
  ["differences", "What differs from the desktop app"],
  ["webgl", "WebGL and the desktop build"],
  ["licence", "Licence and provenance"],
  ["corpus", "How the corpus was altered"],
  ["reduction", "What the reduction changes"],
  ["privacy", "Privacy"],
  ["credits", "Credits"],
] as const;

type SectionId = (typeof SECTIONS)[number][0];

const TITLE = Object.fromEntries(SECTIONS) as Record<SectionId, string>;

/** Prose links carry an underline as well as the accent, so a link is not told
 *  apart by colour alone. */
const LINK_CLASS =
  "break-words text-accent underline decoration-accent/35 underline-offset-3 hover:text-accent-hover hover:decoration-accent-hover";

const BACK_CLASS =
  "inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-hover";

function Section({
  id,
  children,
}: {
  id: SectionId;
  children: ReactNode;
}): ReactNode {
  return (
    <section id={id} className="mt-14 scroll-mt-8 first:mt-10">
      <h2 className="mb-4 text-xl font-semibold tracking-tight text-ink">
        {TITLE[id]}
      </h2>
      <div className="space-y-4">{children}</div>
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
      className={LINK_CLASS}
    >
      {children}
    </a>
  );
}

function Kbd({ children }: { children: ReactNode }): ReactNode {
  return (
    <kbd className="inline-flex h-5 items-center rounded border border-b-2 border-line-strong bg-surface px-1.5 align-middle font-sans text-xs font-medium text-ink">
      {children}
    </kbd>
  );
}

/** A chord, kept on one line. */
function Combo({ children }: { children: ReactNode }): ReactNode {
  return <span className="whitespace-nowrap">{children}</span>;
}

/** The arrow glyphs draw as hairlines at this size (the up arrow reads as a
 *  pipe), so the key carries the icon and names itself for a screen reader. */
const ARROW_CLASS = {
  up: "size-3 rotate-90",
  left: "size-3",
  right: "size-3 rotate-180",
} as const;

function ArrowKey({ dir }: { dir: keyof typeof ARROW_CLASS }): ReactNode {
  return (
    <Kbd>
      <Icon name="arrowLeft" className={ARROW_CLASS[dir]} strokeWidth={2.25} />
      <span className="sr-only">
        {dir === "up" ? "Up" : dir === "left" ? "Left" : "Right"}
      </span>
    </Kbd>
  );
}

function Lead({ children }: { children: ReactNode }): ReactNode {
  return <span className="font-semibold text-ink">{children}</span>;
}

/** Answers the scroll position it left the reader at, `null` if the URL names
 *  no fragment. A fragment whose target is not drawn yet (a letter of the
 *  credits) answers where the reader stands, so the settled pass can still
 *  bring them to it. */
function scrollToFragment(): number | null {
  const id = window.location.hash.slice(1);
  if (id === "") return null;
  // `scrollIntoView` with no argument is instant, so `scrollY` is the position
  // it produced.
  document.getElementById(id)?.scrollIntoView();
  return window.scrollY;
}

export default function AboutPage({ api }: { api: ApiClient }): ReactNode {
  const [features, setFeatures] = useState<FeatureReport | null>(null);
  const [featuresSettled, setFeaturesSettled] = useState(false);
  useEffect(() => {
    let ignore = false;
    api.features().then(
      (report) => {
        if (ignore) return;
        setFeatures(report);
        setFeaturesSettled(true);
      },
      () => {
        if (!ignore) setFeaturesSettled(true);
      },
    );
    return () => {
      ignore = true;
    };
  }, [api]);
  // Unknown and failed read as off, as every gated surface does
  // (`feature-report`), which leaves the copy the page was written for: the
  // public demo's.
  const has = (field: keyof FeatureReport): boolean =>
    features?.[field] === true;
  // The two fields that say the reader is the server's operator rather than a
  // visitor to it.
  const operator = has("hostDetails") || has("appLaunch");

  // From the data the lightbox draws one kit's credits from, so the two cannot
  // disagree. Ignore-on-stale: nothing runs server-side to stop.
  const [credits, setCredits] = useState<CreditsState>({ kind: "loading" });
  useEffect(() => {
    let ignore = false;
    api.credits().then(
      (kits) => {
        if (!ignore) setCredits({ kind: "ready", kits });
      },
      () => {
        if (!ignore) setCredits({ kind: "failed" });
      },
    );
    return () => {
      ignore = true;
    };
  }, [api]);
  const groups = useMemo(
    () => (credits.kind === "ready" ? byLetter(credits.kits) : []),
    [credits],
  );

  // React renders the sections after the browser has already looked for the
  // fragment, so `#credits` opened cold lands at the top. Scrolled twice:
  // after mount, and again once the credits list and the posture copy have
  // given the page its final height.
  const settled = credits.kind !== "loading" && featuresSettled;
  // Gates the second scroll: a reader who has since scrolled away must not be
  // yanked back.
  const landedAt = useRef<number | null>(null);
  useEffect(() => {
    landedAt.current = scrollToFragment();
  }, []);
  useEffect(() => {
    if (!settled) return;
    const at = landedAt.current;
    if (at === null || window.scrollY !== at) return;
    landedAt.current = scrollToFragment();
  }, [settled]);

  const withheld = [
    !has("appLaunch") && (
      <li key="launch">
        Opening a model in a slicer or any other application is not offered here
        — that is a desktop action, and a server has nobody&rsquo;s desktop to
        open it on.
      </li>
    ),
    !has("hostDetails") && (
      <li key="path">
        Copying a model&rsquo;s path copies its place in this library, not a
        location on the machine serving it.
      </li>
    ),
    !has("thumbWrites") && (
      <li key="thumbs">
        Thumbnails were rendered ahead of time and are read-only: nothing you do
        writes anything back to the server.
      </li>
    ),
    !has("thumbWrites") && (
      <li key="framing">
        A model you turn stays turned while you are looking at it and no longer,
        where the desktop app would save the framing for everyone.
      </li>
    ),
    !has("hostDetails") && (
      <li key="host">
        Nothing here names the machine this runs on, so an explanation that
        would send you to fix something on it is replaced by a plain statement
        that a thing is unavailable.
      </li>
    ),
  ].filter((item) => item !== false);

  return (
    // The app's root grounds itself on its own top-level element; this document
    // has none, so without a ground of its own it draws light text on white.
    <main className="min-h-screen bg-canvas text-base leading-relaxed text-ink/85">
      {/* Below `lg` one column, the index under the title; from `lg` the index
          is a sticky column beside the text, which keeps its measure. */}
      <div className="mx-auto max-w-[calc(60ch_+_4rem)] px-5 pt-6 pb-16 sm:px-8 sm:pt-10 lg:grid lg:w-fit lg:max-w-none lg:grid-cols-[11rem_minmax(0,60ch)] lg:gap-x-16">
        {/* The way back, and the repository opposite it. */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 lg:col-span-2">
          <a href="/" className={BACK_CLASS}>
            <Icon name="arrowLeft" />
            Back to the models
          </a>
          <span className="text-[13px] text-ink-3">
            Source:{" "}
            <Out href={SOURCE_URL}>github.com/ConfusedSky/model-browser</Out>
          </span>
        </div>
        <h1 className="mt-10 text-3xl font-semibold tracking-tight text-ink lg:col-start-2 lg:row-start-2 lg:mt-14">
          {operator ? "About Model Browser" : "About this demo"}
        </h1>

        <nav
          aria-label="On this page"
          className="mt-8 rounded-xl border border-line bg-surface px-4 py-3 lg:sticky lg:top-10 lg:col-start-1 lg:row-span-2 lg:row-start-2 lg:mt-16 lg:max-h-[calc(100dvh_-_5rem)] lg:self-start lg:overflow-y-auto lg:border-0 lg:bg-transparent lg:p-0"
        >
          <p className="mb-2 text-xs font-medium tracking-wider text-ink-3 uppercase">
            On this page
          </p>
          <ol className="grid grid-cols-2 gap-x-4 text-sm lg:grid-cols-1 lg:border-l lg:border-line lg:text-[13px]">
            {SECTIONS.map(([id, title]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="-ml-px block border-l border-transparent py-1 leading-snug text-ink-2 hover:text-ink lg:pl-3 lg:hover:border-ink-3"
                >
                  {title}
                </a>
                {/* Where the column stays in view; narrower screens get the
                    bar at the head of the list instead. */}
                {id === "credits" && groups.length > 0 && (
                  <LetterLinks
                    groups={groups}
                    className="hidden grid-cols-6 gap-0.5 pt-1 pb-2 pl-3 lg:grid"
                  />
                )}
              </li>
            ))}
          </ol>
        </nav>

        <div className="lg:col-start-2 lg:row-start-3">
          {/* source: landing-page's proposal.md; deploy/demo/config.json. A tile
            there is a baked picture (`corpus-bake`), not a render; the mesh is
            fetched to draw one, which a lingering hover and a drag do as well
            as an open. Where thumbnails are written, the browser renders a
            missing one and the server keeps it. */}
          <Section id="what">
            <p>
              {operator
                ? "Model Browser is a viewer for a library of 3D-print models."
                : "A public demo of Model Browser, a viewer for a library of 3D-print models."}{" "}
              It can search by what a model looks like instead of by what its
              file is called.
            </p>
            <p>
              The tiles are pictures.{" "}
              {has("thumbWrites")
                ? "Your browser draws each one the first time its model is shown and the server keeps it, so from then on a screen of them costs"
                : "This deployment renders one for every model ahead of time and serves it, so a screen of them costs"}{" "}
              kilobytes rather than the megabytes the models themselves weigh.
              Open one and the mesh is sent to your browser and drawn with WebGL
              — that is the model you turn, and why turning it is smooth once it
              arrives.
            </p>
            {operator ? (
              <p>
                The library it opens here is the folder this server was pointed
                at. The public demo runs the same application over a corpus of
                tabletop miniatures, and what this page says about that corpus —
                its licences, how it was altered, the search examples — is about
                the demo rather than this library.
              </p>
            ) : (
              <p>
                The library it opens here is a corpus of tabletop miniatures
                assembled for the demo. The same application runs over a private
                library on a desktop machine, which is what it was written for.
              </p>
            )}
          </Section>

          {/* The corpus repository is private and gets no link. */}
          <Section id="links">
            <ul className="list-disc space-y-2 pl-5 marker:text-ink-3">
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
                <a href="#credits" className={LINK_CLASS}>
                  {operator
                    ? "Credits for the kits in this library"
                    : "Credits for every kit in the corpus"}
                </a>
              </li>
            </ul>
          </Section>

          {/* source: App's header and toolbar and its window key handler (`/`,
            Alt+Up, the find binding), PathBar, Grid's `onKeyDown` and
            `onMenuKey`, ViewerLayer's key handler. At most five items
            (`visitor-intro`), so a new control joins an item rather than
            adding one. */}
          <Section id="how-to">
            <ul className="list-disc space-y-3 pl-5 marker:text-ink-3">
              <li>
                <Lead>Search.</Lead> <Kbd>/</Kbd> jumps to the search field,
                which searches the folder you are in and everything below it —
                by file and folder name, or, with the Name | Meaning switch
                inside it set to Meaning, by what the models look like.
              </li>
              <li>
                <Lead>Where you are.</Lead> The path under the search field is a
                row of breadcrumbs: click a folder in it to go there, or the
                empty space after it to type a path.{" "}
                <Combo>
                  <Kbd>Alt</Kbd>+<ArrowKey dir="up" />
                </Combo>{" "}
                goes up a folder, the same as the arrow at its left.
              </li>
              <li>
                <Lead>The toolbar.</Lead> Narrow filters what is shown by name —{" "}
                <Combo>
                  <Kbd>Ctrl</Kbd>+<Kbd>F</Kbd>
                </Combo>
                , or{" "}
                <Combo>
                  <Kbd>Cmd</Kbd>+<Kbd>F</Kbd>
                </Combo>{" "}
                on a Mac, the one binding that replaces your browser&rsquo;s own
                find while you are here. Flat puts every model below the folder
                in one grid, and the grid buttons set the tile size: small,
                medium or large. Occlusion switches ambient occlusion on and
                off; turn it off if turning a model feels slow. Options opens{" "}
                {has("maintenance")
                  ? "the search options and the library tools."
                  : "the search options."}
              </li>
              <li>
                <Lead>A tile.</Lead> Drag a model to turn it; click it to open
                it. The arrow keys move between tiles, and <Kbd>Enter</Kbd> or{" "}
                <Kbd>Space</Kbd> opens the one you are on. A tile&rsquo;s ⋯
                button, a right-click,{" "}
                <Combo>
                  <Kbd>Shift</Kbd>+<Kbd>F10</Kbd>
                </Combo>{" "}
                or the Menu key opens its actions; Shift+right-click goes past
                them to the browser&rsquo;s own menu.
              </li>
              <li>
                <Lead>The viewer.</Lead> <ArrowKey dir="left" /> and{" "}
                <ArrowKey dir="right" /> step to the previous and next model,
                and <Kbd>Esc</Kbd> closes it, as it closes a menu or the Narrow
                field.
              </li>
            </ul>
          </Section>

          {/* source: mini-classify's `src/pose.py` and `src/query.py` — **read
            those, not its write-ups**, which are stale on how the two votes
            combine and on what opens the arbiter. Pooling is selectable, so the
            copy names the default and the exception. */}
          <Section id="technical">
            <p>
              The server is Bun and Hono; the client is React and three.js, with
              one WebGL renderer for the whole page — it draws the viewer, and
              any tile the server does not already hold a picture for. Meaning
              search is a separate service holding SigLIP embeddings of each
              model as seen from several angles, so a typed phrase and a picture
              of a model are compared in one embedding space — which is why a
              description finds things whose file names say nothing. A
              model&rsquo;s score for a phrase is pooled from all of its views
              by default, rather than read off one of them — the search options
              can ask for its single best view instead.
            </p>
            <p>
              Before a model is drawn at all, something has to settle which way
              up it stands and which side of it faces you. That pair is its
              pose, and finding it is the harder half of this and the invisible
              one: a library of miniatures lying on their sides is unreadable,
              and nothing in an STL says which way is up. Three tiers decide the
              up. The first is geometry — how much of the mesh rests flat on
              each candidate base, with the runner-up&rsquo;s score against the
              best standing for confidence. The second renders the model under
              each of six candidate ups and scores those renders against text
              prompts for upright and toppled; it runs on every model, and its
              scores are added to geometry&rsquo;s with geometry&rsquo;s turned
              down in proportion to how much flat base it found. A figure with
              none at all — leaping, flying, based on a rock — is where geometry
              is confidently wrong, and turning it down is how the pictures get
              to overrule it there. The third tier asks a vision-language model,
              and it is asked only where the first two together came out close:
              what opens that gate is how narrowly the combined vote won, not
              how sure the geometry was.
            </p>
            <p>
              The front view is chosen the same way, by scoring the
              model&rsquo;s own views against front and back prompts in that
              same embedding space, so it costs no extra render. The pose is
              kept as data rather than baked into the file, which is why the
              listings, the folder contact sheets and the search results all
              stand a model up the same way — and why turning one yourself
              overrides the pose without discarding it.
            </p>
          </Section>

          {/* source: each example run against the deployment's own index — the
            copy names what each returned, so re-run the four rather than
            trusting it. Two traps: **two** kits name a vampire, and README.md's
            staff/broomstick examples do not reproduce on this index. */}
          <Section id="limitations">
            <p>
              Meaning search returns the nearest things to what you described,
              and nearest is not the same as right. It ranks; it does not judge.{" "}
              {operator
                ? "Four ways that shows, each one run against the public demo’s index of miniatures — on this library the models that come back will differ:"
                : "Four ways that shows, each one run against this deployment’s own index:"}
            </p>
            <ul className="list-disc space-y-3 pl-5 marker:text-ink-3">
              <li>
                <Lead>Nothing clears the floor.</Lead> A meaning search keeps
                only hits above a score floor, so a query this corpus has
                nothing for can come back empty: ask for <em>a bicycle</em> and
                the page says nothing matched. That is the search declining to
                guess, not an empty folder.
              </li>
              <li>
                <Lead>A concept the corpus barely holds.</Lead> Ask for{" "}
                <em>a submarine</em> and the first screen is a treasure mimic, a
                quiver, a keyring sewing machine and a longboat — hull-shaped
                and box-shaped things, because there is no submarine here to
                find. What comes back is whatever was least far away, and it
                arrives without the &ldquo;Nothing stood out — these are the
                closest&rdquo; notice: that notice measures how far the best hit
                stands above the collection&rsquo;s own spread and fires only
                for unambiguous noise. A confident wrong answer like this one
                clears it unmarked.
              </li>
              <li>
                <Lead>Neighbouring concepts blur.</Lead> Ask for{" "}
                <em>a vampire</em> and the list opens with robed spellcasters,
                zombies and elves — with neither of the two kits whose names
                actually say <em>vampire</em> among them. The drow follow those,
                one of the vampire kits sits well down the list, and the first
                ghoul further down still. Each of the things above them is a
                fair reading of part of what a vampire is — undead, sinister,
                caped — and the search cannot pull them apart.
              </li>
              <li>
                <Lead>Part of a query counts as a match.</Lead> Ask for{" "}
                <em>an elf carrying an orb</em> and the first five are an elven
                mage, a halfling sorceress, an ogre, a human warlock holding an
                orb, and another mage. One score for a whole phrase cannot
                insist on both halves of it at once, so a figure that is neither
                an elf nor holding anything can outrank the one hit whose name
                says it carries an orb.
              </li>
            </ul>
          </Section>

          {/* source: the feature report, one item per capability it declares
            off, and entryActions.ts for what each withholds. The Download
            action is unbuilt (D10). */}
          <Section id="differences">
            {withheld.length > 0 ? (
              <ul className="list-disc space-y-2 pl-5 marker:text-ink-3">
                {withheld}
              </ul>
            ) : (
              <p>
                Nothing: this server offers what the desktop app does — opening
                a model in another application, keeping how you turned it, and
                showing where its files are.
              </p>
            )}
          </Section>

          {/* source: three/renderer.ts (one renderer app-wide, D2). */}
          <Section id="webgl">
            <p>
              The models are drawn with WebGL. A browser or a machine without it
              will show these pages and the tiles, but no geometry.
            </p>
            {operator ? (
              <p>
                This is the application the public demo runs, here over your own
                library. The <Out href={SOURCE_URL}>source</Out> is what it is
                built from.
              </p>
            ) : (
              <p>
                This is the same application you can run over your own library:
                point the server at a folder and it browses that instead, with
                the actions this deployment withholds restored. The{" "}
                <Out href={SOURCE_URL}>source</Out> is what you would build.
              </p>
            )}
          </Section>

          {/* source: the corpus repository's metadata contract and NOTES.md;
            ViewerLayer's credit rows; `OverrideCredits`. */}
          <Section id="licence">
            <p>
              {operator
                ? "None of the public demo’s models are mine. Each was published by its designer under a"
                : "None of these models are mine. Each was published by its designer under a"}{" "}
              <Out href="https://creativecommons.org/licenses/">
                Creative Commons licence
              </Out>{" "}
              and is redistributed {operator ? "there" : "here"} on those terms.
              The licences differ from model to model, and each model&rsquo;s
              own is linked from its credits.
            </p>
            <p>
              {operator
                ? "A model whose kit is credited is credited where it is shown:"
                : "Every model is credited where it is shown:"}{" "}
              open one and the panel beside it names the author, the licence —
              linked to the deed that carries its version — and the page the
              file came from, with a line saying what was done to this copy
              where the file served is not the author&rsquo;s own. The same
              credits for every kit are{" "}
              <a href="#credits" className={LINK_CLASS}>
                listed at the bottom of this page
              </a>
              .
            </p>
          </Section>

          {/* source: the corpus repository's convert.py and NOTES.md (private,
            so named and not linked). Tile names are two rules: `/api/dir` gives
            a kit a `displayName` and gives the models inside it none. No
            download action exists (D10). */}
          <Section id="corpus">
            <p>
              {operator
                ? "What the public demo serves is not the designers’ files verbatim, and each model’s credits there say so in the corpus’s own words:"
                : "What is served here is not the designers’ files verbatim, and each model’s credits say so in the corpus’s own words:"}
            </p>
            <ul className="list-disc space-y-2 pl-5 marker:text-ink-3">
              <li>
                Duplicates were removed. Publishers reuse meshes heavily, and
                geometry uploaded more than once is kept once.
              </li>
              <li>
                Only the meshes were kept; the other files that came with a kit
                are not here.
              </li>
              <li>
                Meshes were re-exported as STL, and one too heavy to draw in a
                browser tab was reduced until it was not. A mesh already light
                enough was passed through untouched.
              </li>
              <li>
                A kit&rsquo;s own tile is named from the corpus&rsquo;s metadata
                rather than from its folder, so the folder{" "}
                <span className="font-mono text-sm break-words text-ink-2">
                  1_Treasure_Token_for_DD_or_Other_RPG_2615634
                </span>{" "}
                reads as “1&quot; Treasure Token for D&amp;D or Other RPG”. The
                models inside a kit keep their own file names, which are the
                designer&rsquo;s.
              </li>
            </ul>
            <p>
              So every model {operator ? "there" : "here"} is a display copy,
              reduced to be drawn in a browser tab and not to be printed. The
              designer&rsquo;s own file is where the source link in a
              model&rsquo;s credits leads; print from that.
            </p>
            <p>
              The scripts that fetched the models and the metadata that records
              their provenance live in a separate, private repository; this one
              holds the application.
            </p>
          </Section>

          {/* source: the corpus repository's convert.py — one triangle ceiling
            applied by script, and a mesh under it copied through. Verified
            against the corpus: a kit whose credit line says only "re-exported
            as STL" is byte-identical between the original and served trees.
            Says what the reduction does and what it leaves alone; it does not
            argue a licence, which is not this page's business. */}
          <Section id="reduction">
            <p>
              The reduction is one rule applied by a script, not a judgement
              taken model by model: a mesh heavier than a fixed ceiling is
              simplified until it sits under it, and a mesh already under the
              ceiling is copied through with nothing done to it. Which of the
              two happened to a kit is in its credit line.
            </p>
            <p>
              What it changes is surface resolution — the number of triangles a
              shape is described with. Shape, proportion and pose it leaves
              alone, and at the sizes shown here the two are hard to tell apart.
              It is also why {operator ? "the demo’s files" : "these files"} are
              for looking at: print from the designer&rsquo;s own, which the
              source link in a model&rsquo;s credits leads to.
            </p>
          </Section>

          {/* source: the `model-browser:` keys read through lib/stored.ts, and
            api/localFramings.ts; where thumbnails are written, the orbit's
            persist. The search options are the exception because they are not
            local: the tuning is posted with the query and written into the
            address bar. */}
          <Section id="privacy">
            <p>
              There are no accounts and nothing to sign in to, and no analytics
              script runs on these pages. Whether you dismissed the
              introduction, the ambient-occlusion setting, the tile size, your
              search options, the folders you have opened recently and how you
              left the options panel are kept in this browser&rsquo;s own
              storage; the server holds none of them for you, and clearing this
              site&rsquo;s data is the whole of forgetting them.{" "}
              {has("thumbWrites")
                ? "How you turn a model is the exception: it is saved on the server with the model’s thumbnail, so every browser that opens this library sees it the same way."
                : "How you have turned a model is kept nowhere at all — not here, not on the server."}
            </p>
            <p>
              Your search options go one place more. They say which models a
              search returns, so the mode and the tuning are written into the
              address bar as well as into this browser. A link you copy carries
              them, which is what makes the results you send someone the results
              they see.
            </p>
          </Section>

          {/* source: `library-overrides` — the rows are ViewerLayer's, field for
            field. */}
          <Section id="credits">
            <p>
              Every model is credited in the panel beside it when you open it in
              the browser. This list is the same credits for the whole{" "}
              {operator ? "library" : "corpus"} in one place.
            </p>
            <CreditsList state={credits} groups={groups} />
          </Section>

          <div className="mt-16 border-t border-line pt-6">
            <a href="/" className={BACK_CLASS}>
              <Icon name="arrowLeft" />
              Back to the models
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}

type CreditsState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; kits: readonly CreditedKit[] };

type LetterGroup = { letter: string; kits: CreditedKit[] };

/** Links only, no list items: `#credits li` is one per kit. */
function LetterLinks({
  groups,
  className,
}: {
  groups: readonly LetterGroup[];
  className: string;
}): ReactNode {
  return (
    <nav aria-label="Credits by first letter" className={className}>
      {groups.map(({ letter }) => (
        <a
          key={letter}
          href={`#${letterId(letter)}`}
          title={
            letter === OTHER
              ? "Names starting with a digit or symbol"
              : undefined
          }
          className="flex h-6 min-w-6 items-center justify-center rounded text-xs font-medium text-ink-2 hover:bg-surface hover:text-accent"
        >
          {letter}
        </a>
      ))}
    </nav>
  );
}

function CreditsList({
  state,
  groups,
}: {
  state: CreditsState;
  groups: readonly LetterGroup[];
}): ReactNode {
  if (state.kind === "loading") return <p>Loading…</p>;
  // A reader who came for the attribution needs to know the list is missing,
  // not why.
  if (state.kind === "failed") return <p>The credits could not be loaded.</p>;
  // The ordinary desktop case, where an empty `<ul>` would read as a bug.
  if (state.kits.length === 0) return <p>The store holds no credits.</p>;
  return (
    <div>
      <p className="text-sm text-ink-3">
        {state.kits.length === 1 ? "One kit" : `${state.kits.length} kits`}, by
        name.
      </p>
      {/* Sticky inside the section, so it lets go where the credits end. */}
      <LetterLinks
        groups={groups}
        className="sticky top-0 z-10 -mx-2 mt-2 grid grid-cols-[repeat(auto-fill,minmax(1.75rem,1fr))] gap-0.5 border-b border-line bg-canvas/95 px-1 py-2 backdrop-blur-sm lg:hidden"
      />
      {groups.map(({ letter, kits }) => (
        // Clears the sticky bar at up to three rows, which is what a narrow
        // phone wraps it to.
        <div
          key={letter}
          id={letterId(letter)}
          className="scroll-mt-28 lg:scroll-mt-8"
        >
          <h3 className="mt-8 mb-3 flex items-center gap-3 text-base font-semibold text-ink after:h-px after:flex-1 after:bg-line">
            {letter}
          </h3>
          <ul className="space-y-2.5">
            {kits.map((kit) => (
              <CreditLine key={kit.path} kit={kit} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The group for a name that does not start with a letter A–Z. */
const OTHER = "#";

function letterId(letter: string): string {
  return letter === OTHER ? "credits-other" : `credits-${letter.toLowerCase()}`;
}

/** What a kit with no stored display name is called on its tile. */
function lastSegment(path: string): string {
  const parts = path.split("/").filter((p) => p !== "");
  return parts[parts.length - 1] ?? path;
}

function kitName(kit: CreditedKit): string {
  return kit.name ?? lastSegment(kit.path);
}

/** Sorted by the name the tile shows, grouped by its first letter with accents
 *  folded. Grouped through a map rather than by runs: the collation can put a
 *  non-Latin name after Z, which runs would split into a second `#`. */
function byLetter(kits: readonly CreditedKit[]): LetterGroup[] {
  const sorted = [...kits].sort((a, b) =>
    kitName(a).trim().localeCompare(kitName(b).trim(), undefined, {
      sensitivity: "base",
      numeric: true,
    }),
  );
  const groups = new Map<string, CreditedKit[]>();
  for (const kit of sorted) {
    const first = kitName(kit).trim().normalize("NFD").charAt(0).toUpperCase();
    const letter = first >= "A" && first <= "Z" ? first : OTHER;
    const group = groups.get(letter);
    if (group === undefined) groups.set(letter, [kit]);
    else group.push(kit);
  }
  return [...groups]
    .map(([letter, members]) => ({ letter, kits: members }))
    .sort((a, b) =>
      a.letter === OTHER
        ? -1
        : b.letter === OTHER
          ? 1
          : a.letter < b.letter
            ? -1
            : 1,
    );
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

function CreditAnchor({
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

/** The lightbox panel's fields and order (`credits-completion` D4). One block
 *  with a hanging indent, so the names are all that sits at the margin. */
function CreditLine({ kit }: { kit: CreditedKit }): ReactNode {
  const { credits } = kit;
  // A field whose URL this page will not follow draws as one with no URL, a
  // shape the row already has.
  const authorHref = safeHref(credits.authorUrl);
  const licenseHref = safeHref(credits.licenseUrl);
  const sourceHref = safeHref(credits.sourceUrl);
  return (
    <li className="pl-4 -indent-4 text-sm leading-normal break-words text-ink-2">
      <span data-credit="name" className="font-medium text-ink">
        {kitName(kit)}
      </span>
      {credits.author !== undefined && (
        <span data-credit="author">
          {" by "}
          {authorHref !== undefined ? (
            <CreditAnchor href={authorHref}>{credits.author}</CreditAnchor>
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
            <CreditAnchor href={licenseHref}>{credits.license}</CreditAnchor>
          ) : (
            credits.license
          )}
        </span>
      )}
      {credits.sourceUrl !== undefined && (
        <span data-credit="source">
          {" · "}
          {sourceHref !== undefined ? (
            <CreditAnchor href={sourceHref}>
              {hostLabel(sourceHref)}
            </CreditAnchor>
          ) : (
            // Verbatim, not `hostLabel` of it: a refused URL usually has no
            // host to label, and a row showing nothing would hide the field a
            // reader came to check.
            credits.sourceUrl
          )}
        </span>
      )}
      {credits.modified !== undefined && (
        <span data-credit="modified" className="text-ink-3">
          {" · this copy: "}
          {credits.modified}
        </span>
      )}
    </li>
  );
}
