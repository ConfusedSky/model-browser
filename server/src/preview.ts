/**
 * What a shared address says about itself (link-previews D2/D4/D8). The
 * composition `index.ts` hands this to `createStaticHandler`, which knows only
 * that it is a function: **no Bun APIs, no Hono**, and no route of its own.
 *
 * The budget is the whole design: a `resolve`, one `stat` and — for a model — at
 * most two cache reads, one per AO variant. **No listing, no walk**, whatever path
 * an anonymous GET names, and nothing at all for a host this deployment does not
 * answer to.
 */

import { statSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { THUMB_MIME, THUMB_SIZE } from "../../shared/types";
import type { ThumbCache } from "./cache";
import { isAllowedHost, isLoopbackOrigin, normalize } from "./guard";
import { type Library, canonicalLibPath } from "./library";
import { isZipName } from "./vpath";
import {
  type OverrideHolder,
  displayNameOf,
  resolveOverrides,
} from "./overrides";
import type { Preview } from "./static";

/**
 * The deployment's own words (D8). Literals, because nothing names the
 * deployment: `config.ts` is strict and has no such key, and the About page's
 * copy lives in a React entry the server cannot import.
 */
const DEPLOYMENT_TITLE = "Model Browser";
const DEPLOYMENT_DESCRIPTION =
  "Browse a library of 3D-printable models in your browser.";
const ABOUT_TITLE = "About — Model Browser";
const ABOUT_DESCRIPTION = "What this deployment is, and the models it shows.";

/**
 * The shipped site image, in the dist root (D5): its name **and** its shape in
 * one place, so the PNG-or-JPEG choice stays a single decision.
 */
const SITE_IMAGE = {
  file: "og.png",
  type: "image/png",
  width: 1200,
  height: 630,
} as const;

export interface DescribeDeps {
  library: Library;
  cache: ThumbCache;
  overrides: OverrideHolder;
  origins: readonly string[];
  distDir: string;
}

function lastSegment(libPath: string): string {
  const parts = libPath.split("/").filter((p) => p !== "");
  return parts[parts.length - 1] ?? "";
}

function parentSegment(libPath: string): string {
  const parts = libPath.split("/").filter((p) => p !== "");
  return parts[parts.length - 2] ?? "";
}

export function createDescribe({
  library,
  cache,
  overrides,
  origins,
  distDir,
}: DescribeDeps): (url: URL, headers: Headers) => Promise<Preview> {
  // Once, at construction: a missing file advertised as an image would be
  // answered by the SPA fallback with a 200 `text/html` document (D5), and a
  // per-request `stat` would pay for the check on every document served.
  const hasSiteImage =
    statSync(join(distDir, SITE_IMAGE.file), {
      throwIfNoEntry: false,
    })?.isFile() === true;
  // The guard's own allowlist, normalised once (D6).
  const allowed = normalize(origins);
  // The deployment's declared identity, not the requester's (D3), in the
  // spelling the guard holds it in: a mixed-case configuration entry would
  // otherwise reach `og:url` in a shape nothing else uses.
  const configured = origins.find((origin) => !isLoopbackOrigin(origin));
  const declared =
    configured === undefined ? undefined : new URL(configured).origin;

  return async function describe(url: URL, headers: Headers): Promise<Preview> {
    const origin =
      declared ??
      `${headers.get("x-forwarded-proto") ?? url.protocol.replace(/:$/, "")}://${url.host}`;
    // The address as it was requested, query included: a consumer canonicalises
    // the link it was given, so this restates it whether or not it resolved (D8).
    const requested = `${origin}${url.pathname}${url.search}`;
    const site: Pick<
      Preview,
      "image" | "imageType" | "imageWidth" | "imageHeight" | "card"
    > = {
      card: "summary_large_image",
      ...(hasSiteImage
        ? {
            image: `${origin}/${SITE_IMAGE.file}`,
            imageType: SITE_IMAGE.type,
            imageWidth: SITE_IMAGE.width,
            imageHeight: SITE_IMAGE.height,
          }
        : {}),
    };
    const deployment: Preview = {
      title: DEPLOYMENT_TITLE,
      description: DEPLOYMENT_DESCRIPTION,
      ...site,
      url: requested,
    };

    // The entry document is served under no guard — `guard` covers `/api/*`
    // alone — so the library half of this answer applies the guard's own host
    // rule itself: a rebound name is told the deployment and nothing is read
    // (D6). The advertised origin above is unaffected; it is the deployment's.
    if (!isAllowedHost(url.host, allowed)) return deployment;

    // After the gate on purpose: the About strings read nothing, but a name the
    // deployment does not answer to is told the deployment and only that.
    if (url.pathname === "/about.html") {
      return {
        ...deployment,
        title: ABOUT_TITLE,
        description: ABOUT_DESCRIPTION,
      };
    }

    // The query, never the pathname: every shareable address *is* `/` (D2).
    const model = url.searchParams.get("model");
    if (model !== null && model !== "") {
      try {
        const libPath = canonicalLibPath(model);
        // `resolve` confines; it answers a joined path for one that is merely
        // absent, so the `stat` below is the only existence check there is (D4) —
        // and the title is computed after it, never before, or a fabricated path
        // titles the document.
        const { fsPath, entry } = await library.resolve(libPath);
        const info = await stat(fsPath);
        // A model is a file: `?model=/Kit` or `?model=/Kit/notes.txt` names none,
        // and titling one is the fabricated-path hole in another shape.
        if (!info.isFile()) return deployment;
        // An archive is a file the app browses as a folder, so it is no model
        // either; its interior is `entry`'s case below.
        if (entry === undefined && isZipName(libPath)) return deployment;
        const mtime = info.mtimeMs;
        // A hit only: answering a preview must never make the server draw, and a
        // blind URL would unfurl broken on every install with an unbaked store.
        // Either variant is that model's picture, so the occluded one is
        // preferred and the plain one (what a browser with AO off drew) is the
        // hit when it is the only one there (D4).
        let ao = true;
        let { gen, png } = await cache.image(libPath, mtime);
        if (png === undefined) {
          ao = false;
          ({ gen, png } = await cache.image(libPath, mtime, false));
        }
        // Inside an archive the `stat` proved the **archive**, not the entry, so
        // a held render is the only existence proof short of reading the central
        // directory — which D8 declines to do for a word (D4).
        if (entry !== undefined && png === undefined) return deployment;
        const store = await overrides.store();
        const credits = resolveOverrides(store, libPath).credits;
        const attribution = [credits?.author, credits?.license]
          .filter((part) => part !== undefined && part !== "")
          .join(" — ");
        const described: Preview = {
          title: displayNameOf(store, libPath) ?? lastSegment(libPath),
          description:
            attribution !== ""
              ? attribution
              : parentSegment(libPath) || DEPLOYMENT_DESCRIPTION,
          url: requested,
        };
        if (png === undefined) return { ...described, ...site };
        const image = new URL(`${origin}/api/thumb/image`);
        image.searchParams.set("path", libPath);
        if (!ao) image.searchParams.set("ao", "off");
        // Verbatim: `mtimeMs` is a float and the cache compares it with `===`, so
        // a floor or a `toFixed` here turns every hit into a miss.
        image.searchParams.set("mtime", String(mtime));
        // What pins the bytes immutably (`thumbnail-image-serving` D1).
        image.searchParams.set("gen", String(gen));
        return {
          ...described,
          image: image.toString(),
          imageType: THUMB_MIME,
          imageWidth: THUMB_SIZE,
          imageHeight: THUMB_SIZE,
          card: "summary",
        };
      } catch {
        // Catch-all because four kinds of failure are one answer here, and one
        // escaping ships a document with no varying tags at all (D4).
        return deployment;
      }
    }

    const path = url.searchParams.get("path");
    if (path !== null && path !== "" && path !== "/") {
      try {
        const libPath = canonicalLibPath(path);
        const { fsPath } = await library.resolve(libPath);
        // Both jobs at once: the existence check and the kind check. A zip is a
        // folder in the app and a file on disk, so it takes the deployment's
        // title rather than a read of its central directory (D8).
        if ((await stat(fsPath)).isDirectory()) {
          const store = await overrides.store();
          const named = displayNameOf(store, libPath) ?? lastSegment(libPath);
          if (named !== "") return { ...deployment, title: named };
        }
      } catch {
        // As above: a path the library will not answer for is the deployment.
      }
    }
    return deployment;
  };
}
