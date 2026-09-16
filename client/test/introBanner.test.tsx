// @vitest-environment happy-dom
// The visitor introduction's banner and the header affordances beside it
// (`landing-page` 3.2/3.4/3.5/3.6/3.7).
//
// Every cell here is about *withholding* as much as about drawing: the banner
// is a surface the report introduced, so an unknown report, a failed read and a
// report declaring it off must all leave no trace (`feature-report`). The chips
// are withheld on a second axis — the index's own state — because a query the
// index cannot answer is worse than no query offered.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirListing, SemanticListing } from "../../shared/types";
import { EXAMPLE_QUERIES } from "../../shared/exampleQueries";
import {
  click,
  container,
  DEFAULT_REPORT,
  deferred,
  dirEntry,
  features,
  indexAvailability,
  listDir,
  modelEntry,
  mountAppAtCurrentUrl,
  searchInput,
  semanticSearch,
  settle,
  tiles,
  unmountApp,
  wait,
} from "./appHarness";
import { introDismissedStore } from "../src/lib/intro";
import { applySessionSearchMode } from "../src/lib/searchOptions";

vi.mock("../src/api/client", async () =>
  (await import("./appHarness")).apiClientModule(),
);
vi.mock("../src/three/renderer", async (importOriginal) =>
  (await import("./appHarness")).rendererModule(importOriginal),
);

/** The library's top — where the banner belongs, and the only view it is drawn
 *  on. The harness's `library` answers `root: '/'`, so this is the boot view. */
const TOP: DirListing = { path: "/", entries: [dirEntry("/Kit")] };
const FOLDER: DirListing = {
  path: "/Kit",
  entries: [modelEntry("/Kit/a.stl")],
};
/** An archive interior — the one location the index covers nowhere, whatever
 *  its collection root (`indexCovers` refuses any path containing `!/`). */
const ZIP: DirListing = {
  path: "/Kit/a.zip!/",
  entries: [modelEntry("/Kit/a.zip!/lid.stl")],
};
const MEANING: SemanticListing = {
  path: "/",
  entries: [modelEntry("/Kit/a.stl")],
  poses: {},
  scores: {},
  scope: {
    path: null,
    status: "indexed",
    indexed: 1,
    scanned: 1,
    covers: ["stl"],
  },
  weak: false,
  capped: false,
};

const INTRO = { ...DEFAULT_REPORT, intro: true };
const READY = { state: "ready" as const, collectionRoot: "/", covers: ["stl"] };

const banner = (): HTMLElement | null =>
  container.querySelector<HTMLElement>(
    '[role="region"][aria-label="Introduction"]',
  );
const chips = (): HTMLButtonElement[] =>
  Array.from(
    container.querySelectorAll<HTMLButtonElement>("button[data-example-query]"),
  );
const buttonNamed = (text: string): HTMLButtonElement | undefined =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent === text,
  );
const linkTo = (href: string): HTMLAnchorElement | null =>
  container.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
const dismissButton = (): HTMLButtonElement | null =>
  container.querySelector<HTMLButtonElement>(
    'button[aria-label="Dismiss introduction"]',
  );
/** The header's own About, told apart from the banner's by its ancestor. */
const headerAbout = (): HTMLAnchorElement | null =>
  container.querySelector<HTMLAnchorElement>('header a[href="/about.html"]');
const headerSurprise = (): HTMLButtonElement | undefined =>
  Array.from(
    container.querySelectorAll<HTMLButtonElement>("header button"),
  ).find((b) => b.textContent === "Surprise me");

beforeEach(() => {
  localStorage.clear();
  // The mode lives in a module closure `localStorage.clear()` does not reach
  // (client/test/CLAUDE.md). Reset through the *session* setter, never
  // `setSearchMode` — that writes the key other cells assert the absence of.
  applySessionSearchMode("name");
});
afterEach(() => unmountApp());

describe("the banner at the library top", () => {
  it("is drawn with its sentence, its chips, the surprise action and no links", async () => {
    features.mockResolvedValue(INTRO);
    indexAvailability.mockResolvedValue(READY);
    await mountAppAtCurrentUrl("/", TOP);
    await settle();

    const b = banner();
    expect(b).not.toBeNull();
    expect(b!.textContent).toContain(
      "Browse a library of 3D-printable miniatures",
    );
    expect(chips().map((c) => c.dataset.exampleQuery)).toEqual([
      ...EXAMPLE_QUERIES,
    ]);
    expect(buttonNamed("Surprise me")).toBeDefined();
    expect(dismissButton()).not.toBeNull();
    // About, Credits and Source were the banner's last three items until
    // 2026-09-16 and are gone (Masa): About is the header's, and the other two
    // are the About page's own. Asserted as "no anchor anywhere in the strip"
    // rather than as three absent addresses, so a fourth link cannot be added
    // here without a cell saying so — `linkTo` searches the whole tree, where
    // the header's own About is a legitimate match.
    expect(b!.querySelectorAll("a")).toHaveLength(0);
    expect(headerAbout()).not.toBeNull();
  });

  it("is absent on the report a server with no configuration answers", async () => {
    indexAvailability.mockResolvedValue(READY);
    await mountAppAtCurrentUrl("/", TOP);
    await settle();
    expect(banner()).toBeNull();
    expect(headerAbout()).toBeNull();
  });

  it("is not inferred from the capabilities being off — a report that never said `intro` draws nothing", async () => {
    // `feature-report`'s *Not inferred*. Thumbnail writes and host details off
    // is the demo's own posture, and so the report a gate reaching for a proxy
    // field would mistake for "this deployment is public". Meaning mode is in
    // force and the index covers the top, so the cycling placeholder's other
    // conditions all hold and the report is the only thing withholding it.
    applySessionSearchMode("meaning");
    features.mockResolvedValue({
      ...DEFAULT_REPORT,
      thumbWrites: false,
      hostDetails: false,
    });
    indexAvailability.mockResolvedValue(READY);
    await mountAppAtCurrentUrl("/", TOP);
    await settle();

    expect(banner()).toBeNull();
    expect(headerAbout()).toBeNull();
    expect(headerSurprise()).toBeUndefined();
    expect(searchInput().placeholder).toBe("Search names and folders…");
  });

  it("is absent while the report has not resolved — withheld, never withdrawn", async () => {
    features.mockReturnValue(new Promise(() => {}));
    indexAvailability.mockResolvedValue(READY);
    await mountAppAtCurrentUrl("/", TOP);
    await settle();
    expect(banner()).toBeNull();
    expect(headerAbout()).toBeNull();
  });

  it("is absent on a folder URL — a deep link lands on what it names", async () => {
    features.mockResolvedValue(INTRO);
    indexAvailability.mockResolvedValue(READY);
    await mountAppAtCurrentUrl("/?path=%2FKit", FOLDER);
    await settle();
    expect(banner()).toBeNull();
    // The introduction is still *offered* there — only the banner is not the
    // view. The header keeps what it promised.
    expect(headerAbout()).not.toBeNull();
  });

  it("is absent on a flat URL at the top — a deep link lands on what it names", async () => {
    // The third clause of `atTop`, and the one with no other cell: the top with
    // the flat toggle on is a view someone asked for, and dropping a banner
    // over it is the same intrusion as dropping one over a folder.
    features.mockResolvedValue(INTRO);
    indexAvailability.mockResolvedValue(READY);
    await mountAppAtCurrentUrl("/?flat=1", TOP);
    await settle();
    expect(banner()).toBeNull();
    expect(headerAbout()).not.toBeNull();
  });

  it("is absent when the report could not be read at all", async () => {
    // The *failed* read, not the unresolved one above: `features` stays `null`
    // either way, but only this cell proves the rejection is handled rather
    // than thrown — a surface gated on a report is withheld when the report is
    // unknown, however it became unknown (`feature-report`).
    features.mockRejectedValue(new Error("network"));
    indexAvailability.mockResolvedValue(READY);
    await mountAppAtCurrentUrl("/", TOP);
    await settle();
    expect(banner()).toBeNull();
    expect(headerAbout()).toBeNull();
    expect(headerSurprise()).toBeUndefined();
  });

  it("is absent on a query URL", async () => {
    features.mockResolvedValue(INTRO);
    indexAvailability.mockResolvedValue(READY);
    semanticSearch.mockResolvedValue(MEANING);
    await mountAppAtCurrentUrl("/?q=a+dragon&mode=meaning", TOP);
    await settle();
    expect(banner()).toBeNull();
  });
});

describe("the chips follow the index, not the report", () => {
  it("withholds them while the index is absent, keeping the sentence and the links", async () => {
    features.mockResolvedValue(INTRO);
    await mountAppAtCurrentUrl("/", TOP);
    await settle();

    expect(banner()).not.toBeNull();
    expect(chips()).toHaveLength(0);
    expect(buttonNamed("Surprise me")).toBeUndefined();
    // The sentence must not promise a search nothing on screen can run.
    expect(banner()!.textContent).toContain(
      "Browse a library of 3D-printable miniatures.",
    );
    expect(banner()!.textContent).not.toContain(
      "describe what you are looking for",
    );
    expect(linkTo("/about.html")).not.toBeNull();
  });

  it("withholds them while the index covers somewhere else", async () => {
    // `indexCovers` is false without a `collectionRoot`, and false for a root
    // the top is not inside — ready is necessary and not sufficient.
    features.mockResolvedValue(INTRO);
    indexAvailability.mockResolvedValue({ state: "ready", covers: ["stl"] });
    await mountAppAtCurrentUrl("/", TOP);
    await settle();
    expect(banner()).not.toBeNull();
    expect(chips()).toHaveLength(0);
  });

  it("offers them once the index answers ready and covering the top", async () => {
    features.mockResolvedValue(INTRO);
    indexAvailability.mockResolvedValue(READY);
    await mountAppAtCurrentUrl("/", TOP);
    await settle();
    expect(chips().length).toBeGreaterThan(0);
  });
});

describe("a chip is a submitted meaning search", () => {
  it("runs the text, names it in the URL under meaning mode, and Back returns to the top", async () => {
    features.mockResolvedValue(INTRO);
    indexAvailability.mockResolvedValue(READY);
    semanticSearch.mockResolvedValue(MEANING);
    await mountAppAtCurrentUrl("/", TOP);
    await settle();
    const top = window.location.search;

    await click(chips()[0]!);
    await settle();

    // `semanticSearch(text, path, tuning, signal)` — the chip sends the phrase
    // at the top under the visitor's own tuning, which is the body the
    // deploy-time check proves the queries against.
    expect(semanticSearch).toHaveBeenCalledWith(
      EXAMPLE_QUERIES[0],
      "/",
      expect.objectContaining({ minScore: 0.1, top: 60 }),
      expect.any(AbortSignal),
    );
    expect(window.location.search).toContain("q=");
    expect(window.location.search).toContain("mode=meaning");
    // The input holds the phrase, exactly as it would after typing it.
    expect(searchInput().value).toBe(EXAMPLE_QUERIES[0]);
    expect(banner()).toBeNull();

    // Play the browser's Back (the harness's rule: happy-dom's own history is
    // not driven through `history.back` in this suite).
    listDir.mockResolvedValue(TOP);
    await act(async () => {
      window.history.replaceState(null, "", `/${top}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await settle();
    expect(banner()).not.toBeNull();
  });

  it("the surprise action runs the query the pick chose", async () => {
    features.mockResolvedValue(INTRO);
    indexAvailability.mockResolvedValue(READY);
    semanticSearch.mockResolvedValue(MEANING);
    await mountAppAtCurrentUrl("/", TOP);
    await settle();

    // The seam is `pickExample`'s `random` parameter; App passes `Math.random`,
    // so pinning that pins the choice to one named query.
    //
    // Restored in the same cell, and that is not tidiness: there is no
    // `restoreMocks` in this workspace's vitest config, so a spy left standing
    // makes `Math.random()` answer 0 for every cell after this one in the file.
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    await click(buttonNamed("Surprise me")!);
    await settle();
    random.mockRestore();
    // Asserted on the global rather than on a result, because that is what the
    // leak is: every cell below this one ran with `Math.random() === 0` — a
    // suite-wide condition no assertion of theirs could have shown.
    expect(vi.isMockFunction(Math.random)).toBe(false);

    expect(semanticSearch).toHaveBeenCalledWith(
      EXAMPLE_QUERIES[0],
      "/",
      expect.anything(),
      expect.any(AbortSignal),
    );
  });

  it("runs at the library's top from inside an archive, which the index covers nowhere", async () => {
    // The header's action is offered here — its gate asks about `/`, not about
    // where the visitor stands — so the search behind it has to be the search
    // that gate describes. Committed at this path instead, the index answers
    // 400 `path is outside the indexed collection`, which nothing on this side
    // pre-empts the way find-similar's `OUTSIDE_CORPUS` does.
    features.mockResolvedValue(INTRO);
    indexAvailability.mockResolvedValue(READY);
    semanticSearch.mockResolvedValue(MEANING);
    await mountAppAtCurrentUrl("/?path=%2FKit%2Fa.zip!%2F", ZIP);
    await settle();

    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    await click(headerSurprise()!);
    await settle();
    random.mockRestore();

    expect(semanticSearch).toHaveBeenCalledWith(
      EXAMPLE_QUERIES[0],
      "/",
      expect.anything(),
      expect.any(AbortSignal),
    );
    // And the URL names the view that ran: the top, with no path left over from
    // the archive it was clicked in.
    expect(window.location.search).not.toContain("path=");
  });

  it("runs a chip at the top with a folder navigation still in flight", async () => {
    // The same defect from the other end: the banner is drawn off the
    // *committed* view, so its chips are still there during a navigation, and a
    // commit built from the live view would quietly search the folder the
    // visitor is on the way into.
    features.mockResolvedValue(INTRO);
    indexAvailability.mockResolvedValue(READY);
    semanticSearch.mockResolvedValue(MEANING);
    await mountAppAtCurrentUrl("/", TOP);
    await settle();

    const held = deferred<DirListing>();
    listDir.mockReturnValue(held.promise);
    await click(tiles()[0]!);
    expect(banner()).not.toBeNull();

    await click(chips()[0]!);
    await settle();

    expect(semanticSearch).toHaveBeenCalledWith(
      EXAMPLE_QUERIES[0],
      "/",
      expect.anything(),
      expect.any(AbortSignal),
    );
    // The abandoned listing lands on a request nobody is waiting for; released
    // here so the promise does not outlive the cell.
    await act(async () => held.resolve(FOLDER));
    await settle();
  });
});

describe("dismissal", () => {
  it("hides the banner and records the choice for the next visit", async () => {
    features.mockResolvedValue(INTRO);
    indexAvailability.mockResolvedValue(READY);
    await mountAppAtCurrentUrl("/", TOP);
    await settle();

    await click(dismissButton()!);
    expect(banner()).toBeNull();
    expect(introDismissedStore.read()).toBe(true);

    // A later visit in the same browser: the flag is what a remount reads.
    await unmountAndRemount();
    expect(banner()).toBeNull();
  });

  it("moves focus to the search box, which the ✕ it unmounts had", async () => {
    // The ✕ is removed from the document by its own click, and a browser
    // answers that by dropping focus to `<body>`: the next Tab restarts at the
    // top of the document and a screen reader loses its place. The box is where
    // the banner's offer is taken up, so that is where focus goes.
    features.mockResolvedValue(INTRO);
    indexAvailability.mockResolvedValue(READY);
    await mountAppAtCurrentUrl("/", TOP);
    await settle();

    dismissButton()!.focus();
    expect(document.activeElement).toBe(dismissButton());
    await click(dismissButton()!);

    expect(banner()).toBeNull();
    expect(document.activeElement).toBe(searchInput());
  });

  it("leaves the banner dismissed for the page even when the write fails", async () => {
    features.mockResolvedValue(INTRO);
    indexAvailability.mockResolvedValue(READY);
    await mountAppAtCurrentUrl("/", TOP);
    await settle();

    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    await click(dismissButton()!);
    expect(banner()).toBeNull();
    setItem.mockRestore();
    // Nothing was recorded, so the next load draws it again — which is the
    // spec's answer, not an error.
    expect(introDismissedStore.read()).toBe(false);
  });

  it("a chip and a Back are not a dismissal", async () => {
    features.mockResolvedValue(INTRO);
    indexAvailability.mockResolvedValue(READY);
    semanticSearch.mockResolvedValue(MEANING);
    await mountAppAtCurrentUrl("/", TOP);
    await settle();
    const top = window.location.search;

    await click(chips()[0]!);
    await settle();
    listDir.mockResolvedValue(TOP);
    await act(async () => {
      window.history.replaceState(null, "", `/${top}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await settle();

    expect(banner()).not.toBeNull();
    expect(introDismissedStore.read()).toBe(false);
  });
});

describe("the header keeps what the banner offered", () => {
  it("carries About and the surprise action after the banner is dismissed", async () => {
    features.mockResolvedValue(INTRO);
    indexAvailability.mockResolvedValue(READY);
    await mountAppAtCurrentUrl("/", TOP);
    await settle();
    await click(dismissButton()!);

    expect(banner()).toBeNull();
    expect(headerAbout()).not.toBeNull();
    expect(headerSurprise()).toBeDefined();
  });

  it("withholds the surprise action where a meaning search cannot run", async () => {
    features.mockResolvedValue(INTRO);
    await mountAppAtCurrentUrl("/", TOP);
    await settle();
    expect(headerAbout()).not.toBeNull();
    expect(headerSurprise()).toBeUndefined();
  });

  it("carries neither on a server with no configuration", async () => {
    indexAvailability.mockResolvedValue(READY);
    await mountAppAtCurrentUrl("/", TOP);
    await settle();
    expect(headerAbout()).toBeNull();
    expect(headerSurprise()).toBeUndefined();
  });
});

describe("the banner does not move the grid", () => {
  it("is outside <main> while the listing is in flight and after it renders", async () => {
    // happy-dom lays nothing out, so no rectangle here means anything: what is
    // assertable is the structural fact the layout claim rests on (D3). The
    // pixel check is on 5173, measuring the first tile's `top` across the
    // landing.
    features.mockResolvedValue(INTRO);
    indexAvailability.mockResolvedValue(READY);
    const held = deferred<DirListing>();
    listDir.mockReturnValue(held.promise);
    await mountAppAtCurrentUrl("/", TOP);
    await settle();

    const main = container.querySelector("main")!;
    expect(banner()).not.toBeNull();
    expect(main.contains(banner())).toBe(false);

    await act(async () => held.resolve(TOP));
    await settle();
    expect(
      container.querySelectorAll("main .grid button").length,
    ).toBeGreaterThan(0);
    expect(banner()).not.toBeNull();
    expect(container.querySelector("main")!.contains(banner())).toBe(false);
  });
});

/** Re-mount at the top with the same storage — a later visit in this browser.
 *  `unmountApp` clears `localStorage`, so the flag is re-written first. */
async function unmountAndRemount(): Promise<void> {
  const dismissed = introDismissedStore.read();
  await unmountApp();
  if (dismissed) introDismissedStore.write(true);
  features.mockResolvedValue(INTRO);
  indexAvailability.mockResolvedValue(READY);
  await mountAppAtCurrentUrl("/", TOP);
  await wait(20);
}
