// @vitest-environment happy-dom
//
// The About page as a document (`visitor-intro`: "The About page carries what
// the banner cannot", "The credits list is every kit the store credits"):
// which sections it has and in what order, the way back, the two things its
// copy must never say, and the four states of the one dynamic section.
//
// Driven against the component with plain react-dom rather than through App,
// because the page is not a view of the app at all — it has its own Vite entry
// and its own root, and there is no App state that reaches it. The only input
// it takes is an `ApiClient`.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CreditedKit } from "../../shared/types";
import type { ApiClient } from "../src/api/client";
import AboutPage from "../src/components/AboutPage";
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The sections the requirement lists, in the order it lists them, paired with
 * the `id` each one is addressed by. The `id`s are part of the contract, not
 * styling: the banner's credits link is `/about.html#credits`.
 */
const SECTIONS: readonly (readonly [string, string])[] = [
  ["what", "What this is"],
  ["licence", "Licence and provenance"],
  ["corpus", "How the corpus was altered"],
  ["differences", "What differs from the desktop app"],
  ["how-to", "How to use it"],
  ["links", "Links"],
  ["privacy", "Privacy"],
  ["webgl", "WebGL and the desktop build"],
  ["technical", "Under the hood"],
  ["limitations", "What the search does badly"],
  ["credits", "Credits"],
];

/**
 * Three kits covering the three ways a line varies: one complete and modified,
 * one with no stored display name, one whose author and licence have no URLs.
 */
const KITS: CreditedKit[] = [
  {
    path: "/Player_Character_Pack_03_3750572",
    name: "Player Character Pack 03",
    credits: {
      author: "Valandar",
      authorUrl: "https://www.thingiverse.com/Valandar",
      license: "Creative Commons - Attribution",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      sourceUrl: "https://www.thingiverse.com/thing:3750572",
      modified: "re-exported as STL and decimated for display",
    },
  },
  {
    path: "/Zombie_Collection_2847691",
    credits: {
      author: "mz4250",
      authorUrl: "https://www.thingiverse.com/mz4250",
      license: "Creative Commons - Attribution",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      sourceUrl: "https://www.myminifactory.com/object/1",
    },
  },
  {
    path: "/Tomb_3784036",
    name: "Tomb",
    credits: {
      author: "Anonymous",
      license: "Creative Commons - Attribution - NonCommercial",
      sourceUrl: "https://cults3d.com/en/3d-model/game/tomb",
    },
  },
];

/**
 * A kit whose stored URLs are not addresses this page will follow. Operator
 * data, so this is not an attack the deployment expects — it is the row shape a
 * typo or a bad import produces, and React renders `href="javascript:…"` as a
 * live link with nothing but a console warning.
 *
 * The licence URL carries leading spaces deliberately: the URL parser strips
 * them before it reads the scheme, so this is the string a `startsWith("http")`
 * guard would wave through.
 */
const HOSTILE: CreditedKit = {
  path: "/Hostile_Kit",
  name: "Hostile Kit",
  credits: {
    author: "Mallory",
    authorUrl: "javascript:alert(1)",
    license: "Creative Commons - Attribution",
    licenseUrl: "  javascript:alert(2)",
    sourceUrl: "javascript:alert(3)",
  },
};

/** An API client that answers `credits()` and nothing else — the only method
 *  this page calls. */
function fakeApi(credits: () => Promise<CreditedKit[]>): ApiClient {
  return { credits } as unknown as ApiClient;
}

let host: HTMLDivElement;
let root: Root;

async function mount(api: ApiClient): Promise<void> {
  await act(async () => {
    root.render(<AboutPage api={api} />);
  });
}

const sections = (): HTMLElement[] =>
  Array.from(host.querySelectorAll("section"));
const lines = (): HTMLElement[] =>
  Array.from(host.querySelectorAll("#credits li"));
/** A credit field's span inside one line, as ViewerLayer addresses its rows. */
const field = (li: HTMLElement, name: string): HTMLElement | null =>
  li.querySelector<HTMLElement>(`[data-credit="${name}"]`);

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("the page as a document", () => {
  it("carries every section, in order, with its id and heading", async () => {
    await mount(fakeApi(() => Promise.resolve([])));
    expect(sections().map((s) => s.id)).toEqual(SECTIONS.map(([id]) => id));
    expect(sections().map((s) => s.querySelector("h2")?.textContent)).toEqual(
      SECTIONS.map(([, title]) => title),
    );
  });

  it("leads with a way back to the models, and the source beside it", async () => {
    await mount(fakeApi(() => Promise.resolve([])));
    const back = host.querySelector("a");
    expect(back?.getAttribute("href")).toBe("/");
    expect(back?.textContent).toContain("Back to the models");
    // The repository moved here from the Links section at the foot on
    // 2026-09-16 (Masa), when the banner stopped carrying it: this page is
    // where a reader who wants the code has arrived, and it was the one thing
    // on it they might have come for and could not see. Asserted as the second
    // anchor, so burying it again is a red cell rather than a silent move.
    const anchors = Array.from(host.querySelectorAll("a"));
    const source = anchors[1];
    expect(source?.getAttribute("href")).toBe(
      "https://github.com/ConfusedSky/model-browser",
    );
    // Before every section, which is what "at the top" has to mean for a
    // document whose sections are all headed.
    const firstSection = host.querySelector("section");
    expect(firstSection).not.toBeNull();
    expect(
      source!.compareDocumentPosition(firstSection!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // And the Links section no longer lists it: the head carries it, the
    // bullet is gone, and the issue tracker and the contact stay because they
    // are follow-ups to the repository rather than the repository. The
    // desktop-build paragraph's own "source" is left alone — that one is a
    // sentence's link, not a second listing of the address.
    const links = host.querySelector("#links");
    expect(
      links?.querySelector(
        'a[href="https://github.com/ConfusedSky/model-browser"]',
      ),
    ).toBeNull();
    expect(
      links?.querySelector(
        'a[href="https://github.com/ConfusedSky/model-browser/issues"]',
      ),
    ).not.toBeNull();
  });

  it("says the tiles are served as pictures, not drawn on arrival", async () => {
    // The page claimed the opposite until 2026-09-16 — "draws every model in
    // the browser rather than shipping pictures of them" — while its own
    // Differences list said thumbnails were rendered ahead of time. On this
    // deployment `corpus-bake` pre-renders every model and `useThumbnails`
    // hands an annotated hit `api.thumbImageUrl(...)`, so a tile costs a WebP
    // and no geometry; the mesh is fetched only when a model is opened.
    await mount(fakeApi(() => Promise.resolve([])));
    const what = (host.querySelector("#what")?.textContent ?? "").replace(
      /\s+/g,
      " ",
    );
    // Both halves, because either alone is the misreading: the grid is
    // pictures, and opening one is what sends the model.
    expect(what).toContain("The tiles are pictures.");
    expect(what).toMatch(/Open one and the mesh is sent to your browser/);
    // The retracted claim, in the shape it was written — a reinstatement is
    // what this cell exists to catch.
    expect(what).not.toMatch(/draws every model in the browser/i);
  });

  it("defines \u201cpose\u201d where it first uses it", async () => {
    // The page's one piece of jargon, and the interface never says it, so a
    // reader has nowhere else to pick it up (Masa, 2026-09-16). Whitespace
    // collapsed before matching: JSX wraps a sentence across source lines, so
    // the rendered text carries the indentation.
    await mount(fakeApi(() => Promise.resolve([])));
    const text = (host.textContent ?? "").replace(/\s+/g, " ");
    const defined = text.indexOf("That pair is its pose");
    expect(defined).toBeGreaterThan(-1);
    // The first use *is* the definition — not a use somewhere above it.
    expect(text.search(/\bpos(e|ed|es)\b/)).toBe(
      defined + "That pair is its ".length,
    );
    // And the definition says what the pair is, in the reader's terms rather
    // than the record's (`up` and a `front` of view, azimuth and elevation).
    expect(text).toContain("which way up it stands and which side of it faces");
  });

  it("states no figure and names nothing on the host", async () => {
    await mount(fakeApi(() => Promise.resolve([])));
    const text = document.body.textContent ?? "";
    // No accuracy figure for posing or for search — the write-ups' tuned
    // numbers are marked not to publish, and a percentage would have to be
    // re-run before it could be true again.
    expect(text).not.toContain("%");
    // No location on the machine the deployment runs on: not a filesystem
    // path, not a cache directory (`feature-report`'s host-details rule).
    for (const prefix of ["/run/", "/srv/", "/home/", "/opt/"]) {
      expect(text).not.toContain(prefix);
    }
    expect(text).not.toMatch(/cache/i);
    // The privacy line does talk about storage — the browser's own, which is
    // not a location on the host and is exactly what the requirement asks the
    // page to say.
    // Whitespace collapsed before matching: JSX wraps the sentence across
    // source lines, so the rendered text carries the indentation.
    const privacy = (host.querySelector("#privacy")?.textContent ?? "").replace(
      /\s+/g,
      " ",
    );
    expect(privacy).toContain("browser’s own storage");
  });
});

/**
 * The sections the page asked to scroll, in order, with the reader's position
 * made observable.
 *
 * happy-dom lays nothing out and `scrollIntoView` moves nothing there, so the
 * stub plays the browser: it records the section and, where `landsAt` is given,
 * scrolls the window the way a real `scrollIntoView` would. That is what lets a
 * cell distinguish "the reader stayed where the first scroll put them" from
 * "the reader is at 0", which is the whole subject below — a stub that left
 * `scrollY` at 0 would pass a page that recorded its position *before*
 * scrolling instead of after.
 */
function watchScrolls(landsAt?: number): {
  ids: string[];
  restore: () => void;
} {
  const ids: string[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element) {
    ids.push(this.id);
    if (landsAt !== undefined) window.scrollTo(0, landsAt);
  };
  return {
    ids,
    restore: () => {
      Element.prototype.scrollIntoView = original;
    },
  };
}

/** A `credits()` whose answer this cell hands over when it chooses to. */
function deferredApi(): {
  api: ApiClient;
  resolve: (kits: CreditedKit[]) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (kits: CreditedKit[]) => void;
  let reject!: (err: unknown) => void;
  const pending = new Promise<CreditedKit[]>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { api: fakeApi(() => pending), resolve, reject };
}

describe("a fragment in the URL", () => {
  beforeEach(() => window.scrollTo(0, 0));
  afterEach(() => window.history.replaceState(null, "", "/about.html"));

  it("scrolls to the named section, then again once the list fills it", async () => {
    // The browser looks for the fragment before React has rendered a single
    // section, so the page has to do the scroll itself after mount (found on
    // 5173: `/about.html#credits` opened at the top). It does it a second time
    // when the credits settle, because the section is the last on the page and
    // a list still saying "Loading…" leaves too little document below it to
    // bring to the top (measured: 2190 px scrolled, the section still 758 px
    // down). The second scroll is licensed only by the reader not having moved
    // — which here means still standing where the *first* scroll left them,
    // 900, and not at the 0 they started from.
    const watch = watchScrolls(900);
    window.history.replaceState(null, "", "/about.html#credits");
    try {
      await mount(fakeApi(() => Promise.resolve([])));
      expect(watch.ids).toEqual(["credits", "credits"]);
    } finally {
      watch.restore();
    }
  });

  it("leaves a reader who has moved since the first scroll where they are", async () => {
    // The yank this replaced: someone who opened `#credits`, then scrolled up
    // to read Licence while the credits were still loading, was thrown back
    // down the moment they arrived.
    const watch = watchScrolls(900);
    window.history.replaceState(null, "", "/about.html#credits");
    const { api, resolve } = deferredApi();
    try {
      await mount(api);
      expect(watch.ids).toEqual(["credits"]);
      window.scrollTo(0, 300);
      await act(async () => {
        resolve([]);
      });
      expect(watch.ids).toEqual(["credits"]);
    } finally {
      watch.restore();
    }
  });

  it("scrolls again when the credits could not be loaded", async () => {
    // The failed read settles the section too, and a reader who asked for
    // `#credits` still wants to be at it — the sentence saying the list is
    // missing is the answer they came for. This is the reject arm of
    // `onSettled`, which the resolve arm's cells say nothing about.
    const watch = watchScrolls(900);
    window.history.replaceState(null, "", "/about.html#credits");
    const { api, reject } = deferredApi();
    try {
      await mount(api);
      expect(watch.ids).toEqual(["credits"]);
      await act(async () => {
        reject(new Error("offline"));
      });
      expect(watch.ids).toEqual(["credits", "credits"]);
    } finally {
      watch.restore();
    }
  });

  it("scrolls nowhere for a fragment that arrived after the page did", async () => {
    // Someone who opened `/about.html` and then clicked the in-page credits
    // link: that navigation was the browser's own, over a document already
    // laid out, so there is no first scroll of ours to correct — and the
    // settling list must not invent one, wherever they have read to by then.
    const watch = watchScrolls(900);
    const { api, resolve } = deferredApi();
    try {
      await mount(api);
      window.history.replaceState(null, "", "/about.html#credits");
      window.scrollTo(0, 1500);
      await act(async () => {
        resolve([]);
      });
      expect(watch.ids).toEqual([]);
    } finally {
      watch.restore();
    }
  });

  it("scrolls nowhere without one", async () => {
    const watch = watchScrolls();
    try {
      await mount(fakeApi(() => Promise.resolve([])));
      expect(watch.ids).toEqual([]);
    } finally {
      watch.restore();
    }
  });
});

describe("the credits list", () => {
  it("draws one line per kit, with the lightbox’s links", async () => {
    await mount(fakeApi(() => Promise.resolve(KITS)));
    expect(lines()).toHaveLength(3);
    const [first, second, third] = lines() as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];

    // The display name where one is stored…
    expect(first.textContent).toContain("Player Character Pack 03");
    // …and the kit's own folder name where none is.
    expect(second.textContent).toContain("Zombie_Collection_2847691");

    const author = field(first, "author")?.querySelector("a");
    expect(author?.getAttribute("href")).toBe(
      "https://www.thingiverse.com/Valandar",
    );
    expect(author?.getAttribute("target")).toBe("_blank");
    expect(author?.getAttribute("rel")).toBe("noreferrer");
    expect(author?.getAttribute("title")).toBe(
      "https://www.thingiverse.com/Valandar",
    );
    expect(author?.textContent).toBe("Valandar");

    const license = field(first, "license")?.querySelector("a");
    expect(license?.getAttribute("href")).toBe(
      "https://creativecommons.org/licenses/by/4.0/",
    );
    expect(license?.textContent).toBe("Creative Commons - Attribution");

    // The source link is labelled with its host, not spelt out, and the whole
    // URL rides the `title` — `hostLabel`'s rule, shared with the panel.
    const source = field(first, "source")?.querySelector("a");
    expect(source?.textContent).toBe("thingiverse.com");
    expect(source?.getAttribute("title")).toBe(
      "https://www.thingiverse.com/thing:3750572",
    );
    expect(field(second, "source")?.querySelector("a")?.textContent).toBe(
      "myminifactory.com",
    );

    // A stored URL is optional per field: no link, but the label still shows.
    expect(field(third, "author")?.querySelector("a")).toBeNull();
    expect(field(third, "author")?.textContent).toContain("Anonymous");
    expect(field(third, "license")?.querySelector("a")).toBeNull();
    expect(field(third, "license")?.textContent).toContain("NonCommercial");
  });

  it("draws the modification phrase only where the store holds one", async () => {
    await mount(fakeApi(() => Promise.resolve(KITS)));
    const [first, second, third] = lines() as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(field(first, "modified")?.textContent).toContain(
      "re-exported as STL and decimated for display",
    );
    expect(field(second, "modified")).toBeNull();
    expect(field(third, "modified")).toBeNull();
  });

  it("draws a URL it will not follow as text, never as a link", async () => {
    await mount(fakeApi(() => Promise.resolve([HOSTILE])));
    const [line] = lines() as [HTMLElement];
    // Not one anchor anywhere in the row — which is stronger than checking
    // each field's `href`, since a scheme that reached any of them would show
    // up here whichever field grew a link next.
    expect(line.querySelectorAll("a")).toHaveLength(0);
    // The fields themselves stay: attribution is what this page is for, and a
    // row that vanished over a malformed URL would take the author's name with
    // it (`hostLabel`'s rule, which this follows).
    expect(field(line, "author")?.textContent).toContain("Mallory");
    expect(field(line, "license")?.textContent).toContain(
      "Creative Commons - Attribution",
    );
    expect(field(line, "source")?.textContent).toContain("javascript:alert(3)");
  });

  it("says so rather than rendering empty when the store holds no credits", async () => {
    await mount(fakeApi(() => Promise.resolve([])));
    expect(lines()).toHaveLength(0);
    expect(host.querySelector("#credits")?.textContent).toContain(
      "The store holds no credits.",
    );
  });

  it("says the list is missing when the read fails", async () => {
    await mount(fakeApi(() => Promise.reject(new Error("offline"))));
    expect(host.querySelector("#credits")?.textContent).toContain(
      "The credits could not be loaded.",
    );
  });

  it("shows a loading line until the answer arrives", async () => {
    let settle: (kits: CreditedKit[]) => void = () => {};
    const pending = new Promise<CreditedKit[]>((resolve) => {
      settle = resolve;
    });
    await mount(fakeApi(() => pending));
    expect(host.querySelector("#credits")?.textContent).toContain("Loading");
    await act(async () => {
      settle(KITS);
    });
    expect(lines()).toHaveLength(3);
  });
});
