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
 * **Every factual sentence below was checked against a named source when it
 * was written (D10)**, and each section carries a comment saying which. The
 * page states no accuracy figure and names no location on the machine the
 * server runs on: the first would have to be re-run to stay true and the
 * second is not the viewer's business (`feature-report`). The three
 * Limitations examples were run against the deployed index on the day; one
 * that stops reproducing is removed rather than kept as lore.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { CreditedKit } from '../../../shared/types'
import type { ApiClient } from '../api/client'
import { CREDIT_LINK_CLASS, hostLabel } from '../lib/credits'

/** The repository this is built from — public, `ConfusedSky/model-browser`. */
const SOURCE_URL = 'https://github.com/ConfusedSky/model-browser'

/** A section's heading, with the `id` a link from elsewhere aims at. */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }): ReactNode {
  return (
    <section id={id} className="mt-8">
      <h2 className="mb-2 text-lg font-semibold text-zinc-100">{title}</h2>
      {children}
    </section>
  )
}

/** One link out of the page. External, so the same rules the credit links use. */
function Out({ href, children }: { href: string; children: ReactNode }): ReactNode {
  return (
    <a href={href} target="_blank" rel="noreferrer" title={href} className={CREDIT_LINK_CLASS}>
      {children}
    </a>
  )
}

export default function AboutPage({ api }: { api: ApiClient }): ReactNode {
  return (
    <main className="mx-auto max-w-3xl p-6 text-zinc-200">
      {/* The way back, first and unmissable: a plain anchor to the library's
          top, because the app has one route and `/` is it. */}
      <a href="/" className="text-sm text-sky-400 hover:underline">
        ← Back to the models
      </a>
      <h1 className="mt-4 text-2xl font-semibold text-zinc-100">About this demo</h1>

      {/* source: openspec/changes/landing-page/proposal.md (Why),
          deploy/demo/config.json (the library this deployment opens). */}
      <Section id="what" title="What this is">
        <p className="mb-2">
          A public demo of Model Browser, a viewer for a library of 3D-print models. It draws
          every model in the browser rather than shipping pictures of them, turns any tile you
          drag, and can search by what a model looks like instead of by what its file is called.
        </p>
        <p>
          The library it opens here is a corpus of tabletop miniatures assembled for the demo.
          The same application runs over a private library on a desktop machine, which is what
          it was written for.
        </p>
      </Section>

      {/* source: the corpus repository's CLAUDE.md ("Metadata contract with
          model-browser", the licence-vocabulary rules) and NOTES.md; the
          lightbox's own credit rows in client/src/viewer/ViewerLayer.tsx;
          shared/types.ts `OverrideCredits`. */}
      <Section id="licence" title="Licence and provenance">
        <p className="mb-2">
          None of these models are mine. Each was published by its designer under a{' '}
          <Out href="https://creativecommons.org/licenses/">Creative Commons licence</Out> and is
          redistributed here on those terms. The licences differ from model to model, and each
          model&rsquo;s own is linked from its credits.
        </p>
        <p>
          Every model is credited where it is shown: open one and the panel beside it names the
          author, the licence — linked to the deed that carries its version — and the page the
          file came from, with a line saying what was done to this copy where the file served is
          not the author&rsquo;s own. The same credits for the whole corpus are{' '}
          <a href="#credits" className="text-sky-400 hover:underline">
            listed at the bottom of this page
          </a>
          .
        </p>
      </Section>

      {/* source: the corpus repository's convert.py (`decimate`, which is
          quadric decimation over a welded mesh, and `modified_phrase`) and its
          CLAUDE.md layout table; NOTES.md ("Publishers reuse meshes heavily",
          the decimation policy); deploy/demo/config.json, whose root is the
          `decimated/` tree — quadric decimation is what ships, replacing the
          vertex clustering used until 2026-09-15 (docs/web-demo-notes.md item
          4). The corpus repository is private, so it is named and not linked. */}
      <Section id="corpus" title="How the corpus was altered">
        <p className="mb-2">
          What is served here is not the designers&rsquo; files verbatim, and each model&rsquo;s
          credits say so in the corpus&rsquo;s own words:
        </p>
        <ul className="mb-2 list-disc space-y-1 pl-5">
          <li>
            Duplicates were removed. Publishers reuse meshes heavily, and geometry uploaded more
            than once is kept once.
          </li>
          <li>Only the meshes were kept; the other files that came with a kit are not here.</li>
          <li>
            Every mesh was re-exported as STL and reduced for display by quadric decimation, so a
            model arrives in a browser tab rather than in a slicer.
          </li>
          <li>The names on the tiles come from the corpus&rsquo;s metadata, not from file names.</li>
        </ul>
        <p className="mb-2">
          So what you download from here is a display copy. Print from the designer&rsquo;s
          original, which the source link in a model&rsquo;s credits leads to.
        </p>
        <p>
          The scripts that fetched the models and the metadata that records their provenance live
          in a separate, private repository; this one holds the application.
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
            Opening a model in a slicer or any other application is not offered here — that is a
            desktop action, and a server has nobody&rsquo;s desktop to open it on.
          </li>
          <li>
            Copying a model&rsquo;s path copies its place in this library, not a location on the
            machine serving it.
          </li>
          <li>The chat tab is not offered.</li>
          <li>
            Thumbnails were rendered ahead of time and are read-only: nothing you do writes
            anything back to the server.
          </li>
          <li>
            A model you turn is remembered in this browser alone, where the desktop app would
            save the framing for everyone.
          </li>
          <li>
            Nothing here names the machine this runs on, so an explanation that would send you to
            fix something on it is replaced by a plain statement that a thing is unavailable.
          </li>
        </ul>
      </Section>

      {/* source: client/src/components/Grid.tsx (the tile's `onKeyDown` —
          Enter and Space — and `onMenuKey`, which takes `ContextMenu` and
          Shift+F10), client/src/App.tsx's window keydown effect (Ctrl/Cmd+F,
          and the ambient-occlusion pill at `fixed bottom-3 left-3`),
          client/src/lib/gesture.ts (`nativeMenuRequested`: a shifted secondary
          press is left to the browser) and ViewerLayer's Escape handler. */}
      <Section id="how-to" title="How to use it">
        <ul className="list-disc space-y-1 pl-5">
          <li>Drag a tile to turn the model; press and release without moving to open it.</li>
          <li>
            Enter or Space opens the model the keyboard is on, and Escape closes what is open.
          </li>
          <li>
            Ctrl+F — Cmd+F on a Mac — narrows the folder you are in by name. It is the one
            binding that replaces your browser&rsquo;s own find while you are here.
          </li>
          <li>
            Shift+F10, or the menu key, opens a tile&rsquo;s actions; Shift+right-click goes past
            them to the browser&rsquo;s own menu.
          </li>
          <li>
            The ambient-occlusion toggle sits at the bottom left — turn it off if turning a model
            feels slow.
          </li>
        </ul>
      </Section>

      {/* source: `gh repo view ConfusedSky/model-browser` (PUBLIC) and
          `gh repo view ConfusedSky/model-browser-corpus` (PRIVATE, so it gets
          no link — see the provenance section above). */}
      <Section id="links" title="Links">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Source: <Out href={SOURCE_URL}>github.com/ConfusedSky/model-browser</Out>
          </li>
          <li>
            Report a problem: <Out href={`${SOURCE_URL}/issues`}>the issue tracker</Out>
          </li>
          <li>
            Contact: <Out href="https://github.com/ConfusedSky">ConfusedSky on GitHub</Out>
          </li>
          <li>
            <a href="#credits" className="text-sky-400 hover:underline">
              Credits for every kit in the corpus
            </a>
          </li>
        </ul>
      </Section>

      {/* source: client/src/lib/stored.ts and the `model-browser:` preference
          keys read through it (the search mode, the ambient-occlusion setting,
          the introduction's dismissal, a model's own framing on this
          deployment); client/index.html and this page, neither of which loads a
          third-party script. */}
      <Section id="privacy" title="Privacy">
        <p>
          There are no accounts and nothing to sign in to, and no analytics script runs on these
          pages. What you change while browsing — which models you have turned, your search
          options, whether you dismissed the introduction — is kept in this browser&rsquo;s own
          storage and is sent nowhere.
        </p>
      </Section>

      {/* source: client/src/three/renderer.ts (one WebGLRenderer app-wide) and
          the repository's own architecture notes; the README's description of
          running the server over a local library. */}
      <Section id="webgl" title="WebGL and the desktop build">
        <p className="mb-2">
          The models are drawn with WebGL. A browser or a machine without it will show these
          pages and the tiles, but no geometry.
        </p>
        <p>
          This is the same application you can run over your own library: point the server at a
          folder and it browses that instead, with the actions this deployment withholds restored.
          The <Out href={SOURCE_URL}>source</Out> is what you would build.
        </p>
      </Section>

      {/* source: CLAUDE.md at the repository root (Bun + Hono server,
          React/Vite/three.js client, one renderer) and server/src/app.ts; for
          the posing, mini-classify's write-ups —
          docs/learnings/2026-08-11-canonical-pose.md (the runner-up/best flat-
          base ratio, the front view scored against front/back prompts in the
          cached view embeddings) and
          docs/archive/superpowers/specs/2026-08-10-pose-pipeline-design.md, the
          2026-08-11 "SigLIP also decides the up axis" entry (six candidate-up
          tiles scored against upright/toppled probes, averaged with the
          geometry vote, run on every model; the VLM tier unchanged behind
          geometry's own confidence gate). No figure from either is quoted: the
          tuned numbers there are marked not to publish. */}
      <Section id="technical" title="Under the hood">
        <p className="mb-2">
          The server is Bun and Hono; the client is React and three.js, with a single WebGL
          renderer shared between the grid&rsquo;s thumbnails and the viewer. Meaning search is a
          separate service holding SigLIP embeddings of a render of every model, so a typed phrase
          and a picture of a model are compared in one embedding space — which is why a
          description finds things whose file names say nothing.
        </p>
        <p className="mb-2">
          Models are posed before they are ever drawn. That is the harder half and the invisible
          one: a library of miniatures lying on their sides is unreadable, and nothing in an STL
          says which way is up. Three tiers decide it. The first is geometry — how much of the
          mesh rests flat on each candidate base, with the runner-up&rsquo;s score against the
          best standing for confidence. The second renders the model under each of six candidate
          ups and scores those renders against text prompts for upright and toppled, averaged
          with the geometry vote; it runs on every model, because a figure with no flat base at
          all — leaping, flying, based on a rock — is exactly where geometry is confidently wrong.
          The third asks a vision-language model, and only about the remainder geometry cannot
          settle.
        </p>
        <p>
          The front view is chosen the same way, by scoring the model&rsquo;s own views against
          front and back prompts in that same embedding space, so it costs no extra render. The
          pose is kept as data rather than baked into the file, which is why the listings, the
          folder contact sheets and the search results all stand a model up the same way — and
          why turning one yourself overrides the pose without discarding it.
        </p>
      </Section>

      {/* source: each example run against this deployment's own index on
          2026-09-15, with the body a visitor's search sends
          (`{"raw":false,"pool":"softmax","top":60,"minScore":0.1}`). First five
          entries of each run, in order:

          "a submarine" (31 entries) — Giant_Mimic_Miniature_25mm_3761513/
          Giant_Mimic.stl, Rogue_and_Ranger_Collection_2435041/Quiver.stl,
          Singer_Sewing_Machine_Keyring_2662532/miniature_sewing_machine.stl,
          DnD_Longboat_-_Oars_and_Mast_2870994/Longboat.stl,
          Mini_Borderlands_Loot_Chest_1280412/lid.stl.

          "a vampire" (60 entries) — The_Acquisitions_Incorporated_Miniature_
          Collection_2653936/Jim_Darkmagic.stl, …/The_REAL_Jim_Darkmagic.stl,
          Zombie_Collection_2847691/Zombie_NEW.stl, Player_Character_Pack_02_
          3101042/MadMageFigure.stl, Player_Character_Pack_03_3750572/
          ElfArmoredMage.stl. The corpus's one vampire kit,
          Vampire_Lord_Monstrous_Strahd_Von_Zarovich_3854115/Strahd_smaller_2.stl,
          came eighteenth.

          "an elf carrying an orb" (60 entries) — Elven_Mage_Miniature_3507584/
          Elven_mage.stl, Wizard_Warlock_Sorcerer_and_Druid_Collection_2435009/
          Female_Halfling_Sorceress.stl, Ogre_2843189/
          Female_Ogre_BODY_AND_STAND.stl, …/Human_Male_Warlock_with_Orb.stl,
          …/Mage.stl.

          Re-run them before trusting this section again; an example that stops
          reproducing is dropped, not reworded. */}
      <Section id="limitations" title="What the search does badly">
        <p className="mb-2">
          Meaning search returns the nearest things to what you described, and nearest is not the
          same as right. Three ways that shows, each one run against this deployment&rsquo;s own
          index:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="font-semibold text-zinc-100">A concept the corpus barely holds.</span>{' '}
            Ask for <em>a submarine</em> and the first screen is a treasure mimic, a quiver, a
            keyring sewing machine and a longboat — hull-shaped and box-shaped things, because
            there is no submarine here to find. What comes back is whatever was least far away,
            not a statement that nothing matched.
          </li>
          <li>
            <span className="font-semibold text-zinc-100">Neighbouring concepts blur.</span> Ask
            for <em>a vampire</em> and the list opens with zombies, ghouls, dark elves and robed
            spellcasters; the one kit in this corpus that actually names a vampire sits well down
            it. The undead and the sinister sit close together, and the query cannot pull them
            apart.
          </li>
          <li>
            <span className="font-semibold text-zinc-100">Part of a query counts as a match.</span>{' '}
            Ask for <em>an elf carrying an orb</em> and elves with nothing in their hands come
            back beside a human warlock holding one, mixed in among the elven mages that answer
            the whole phrase. A hit meeting more of the query usually scores higher, so the full
            matches tend to lead and the partial ones trail.
          </li>
        </ul>
      </Section>

      {/* source: the `visitor-intro` requirement "The credits list is every kit
          the store credits" and `library-overrides`' "The store's credits are
          listable"; the row markup is ViewerLayer's, field for field. */}
      <Section id="credits" title="Credits">
        <p className="mb-2">
          Every model is credited in the panel beside it when you open it in the browser. This
          list is the same credits for the whole corpus in one place.
        </p>
        <CreditsList api={api} />
      </Section>
    </main>
  )
}

/** What the credits section is showing right now. */
type CreditsState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; kits: readonly CreditedKit[] }

/**
 * The one dynamic part of the page: every credited kit the deployment's store
 * holds, drawn from the same data the lightbox draws a single kit's credits
 * from, so the two cannot disagree (`library-overrides`).
 *
 * Ignore-on-stale rather than an abort, like the panel's own overrides read:
 * there is nothing running server-side to stop, and the only thing that can
 * supersede this read is the page going away.
 */
export function CreditsList({ api }: { api: ApiClient }): ReactNode {
  const [state, setState] = useState<CreditsState>({ kind: 'loading' })
  useEffect(() => {
    let ignore = false
    api.credits().then(
      (kits) => {
        if (!ignore) setState({ kind: 'ready', kits })
      },
      () => {
        if (!ignore) setState({ kind: 'failed' })
      },
    )
    return () => {
      ignore = true
    }
  }, [api])

  if (state.kind === 'loading') return <p>Loading…</p>
  // Said plainly rather than shown as a failed request: a reader who came here
  // for the attribution needs to know the list is missing, not why.
  if (state.kind === 'failed') return <p>The credits could not be loaded.</p>
  // A deployment with no override store is the ordinary desktop case, and an
  // empty `<ul>` would read as a bug — the requirement is to say so.
  if (state.kits.length === 0) return <p>The store holds no credits.</p>
  return (
    <ul className="space-y-2 text-sm">
      {state.kits.map((kit) => (
        <CreditLine key={kit.path} kit={kit} />
      ))}
    </ul>
  )
}

/** The last segment of a library path — the kit's own folder name, which is
 *  what a kit with no stored display name is called on its tile. */
function lastSegment(path: string): string {
  const parts = path.split('/').filter((p) => p !== '')
  return parts[parts.length - 1] ?? path
}

/**
 * One kit's line. The fields, their order and their link rules are the
 * lightbox panel's rows (`credits-completion` D4: author, licence, source,
 * then what was done to this copy), reproduced here as one line rather than as
 * a description list because a page of them is a list of kits, not a
 * description of one.
 */
function CreditLine({ kit }: { kit: CreditedKit }): ReactNode {
  const { credits } = kit
  return (
    <li>
      <span className="font-semibold text-zinc-100">{kit.name ?? lastSegment(kit.path)}</span>
      {credits.author !== undefined && (
        <span data-credit="author">
          {' by '}
          {credits.authorUrl !== undefined ? (
            <a
              href={credits.authorUrl}
              target="_blank"
              rel="noreferrer"
              title={credits.authorUrl}
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
          {' · '}
          {/* The label stays the corpus's own string and the deed URL carries
              the version; nothing here is derived from the label. */}
          {credits.licenseUrl !== undefined ? (
            <a
              href={credits.licenseUrl}
              target="_blank"
              rel="noreferrer"
              title={credits.licenseUrl}
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
          {' · '}
          <a
            href={credits.sourceUrl}
            target="_blank"
            rel="noreferrer"
            title={credits.sourceUrl}
            className={CREDIT_LINK_CLASS}
          >
            {hostLabel(credits.sourceUrl)}
          </a>
        </span>
      )}
      {credits.modified !== undefined && (
        <span data-credit="modified" className="text-zinc-400">
          {' · this copy: '}
          {credits.modified}
        </span>
      )}
    </li>
  )
}
