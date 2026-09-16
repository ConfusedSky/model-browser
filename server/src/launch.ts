/**
 * Platform launch operations (open-in-slicer L2/L6–L9), each replaceable by a
 * template from local config. Templates are argv **arrays**, never shell
 * strings, so no file name is ever interpreted by one.
 */

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative, sep } from "node:path";
import type { AppRef, AppsReport, TypeApps } from "../../shared/types";
import { modelFormat } from "./listing";
import { configHome, dataDirs } from "./xdg";
import { extractEntry } from "./zip";

/** A launch or chooser command that failed or could not be spawned. */
export class LaunchError extends Error {}

/** From `modelFormat` (L6), not a second extension table, so the two cannot drift. */
const MIME_BY_FORMAT = {
  stl: "model/stl",
  "3mf": "model/3mf",
  obj: "model/obj",
} as const;

export const HANDLED_MIMES: readonly string[] = Object.values(MIME_BY_FORMAT);

/** The mime for a name or path, undefined when it is not a model. */
export function mimeFor(name: string): string | undefined {
  const format = modelFormat(name);
  return format === undefined ? undefined : MIME_BY_FORMAT[format];
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

export interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** **No `signal`**, structurally: a dropped request must not kill a chooser (L9). */
export interface SpawnOptions {
  /** Own process group, so neither a request nor a `bun --hot` reload reaps it. */
  detached?: boolean;
  /**
   * **Only the two query operations set it**: a piped write-end is inherited by
   * every descendant, so a launch with this on would not resolve until the
   * application quit. `stderr` is collected either way (`stderrSink`).
   */
  capture?: boolean;
}

/** Runs an argv. Resolves with the exit code; rejects only when unspawnable. */
export type ExecFn = (
  file: string,
  args: string[],
  opts: SpawnOptions,
) => Promise<SpawnResult>;

/** Most of a reason fits in a line; this is a guard, not a budget. */
const STDERR_LIMIT = 8192;

/**
 * A *file*, not a pipe: a pipe hangs the request until the launched application
 * quits, and closing its read end early SIGPIPEs that application. Unlinked at
 * once, a POSIX assumption (`docs/platform-surface.md`).
 */
function stderrSink(): number {
  const path = join(tmpdir(), `mb-launch-${randomUUID()}`);
  const fd = openSync(path, "wx+");
  unlinkSync(path);
  return fd;
}

/**
 * The **tail**: a reason is the last thing a command prints, and a chatty child
 * would otherwise hand back its startup noise. The explicit `position` leaves
 * the fd's own offset alone — it belongs to the child.
 */
function readSink(fd: number): string {
  try {
    const total = fstatSync(fd).size;
    const size = Math.min(total, STDERR_LIMIT);
    if (size === 0) return "";
    const buf = Buffer.alloc(size);
    readSync(fd, buf, 0, size, total - size);
    const text = buf.toString("utf8");
    if (total <= size) return text;
    // Marked, so a truncated reason cannot read as the whole of it. The strip is
    // for the cut landing inside a multibyte character, which decodes to U+FFFD.
    return `…${text.replace(/^\uFFFD+/, "")}`;
  } catch {
    // A reason is a nicety; failing to read one must never fail the request.
    return "";
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* already gone */
    }
  }
}

/**
 * `spawn`, not `execFile`: `detached` is what puts a chooser in its own process
 * group (L9) and `@types/node` does not admit it on `execFile`'s options. Either
 * way it is an argv array and never a shell string, so nothing is word-split or
 * metacharacter-interpreted. What ends the request is `capture` — see
 * `SpawnOptions`.
 */
const nodeExec: ExecFn = (file, args, opts) =>
  new Promise((resolve, reject) => {
    const capture = opts.capture === true;
    // Still collected, but into a file — see `stderrSink`.
    const sink = capture ? null : stderrSink();
    let child;
    try {
      child = spawn(file, args, {
        detached: opts.detached === true,
        stdio: capture
          ? ["ignore", "pipe", "pipe"]
          : ["ignore", "ignore", sink as number],
      });
    } catch (err) {
      if (sink !== null) closeSync(sink);
      return reject(err as Error);
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d: string) => {
      stdout += d;
    });
    child.stderr?.on("data", (d: string) => {
      stderr += d;
    });
    // Neither an unspawnable command nor a signal death is a result.
    child.once("error", (err) => {
      if (sink !== null) closeSync(sink);
      reject(err);
    });
    child.once("close", (code, signal) => {
      if (sink !== null) stderr = readSink(sink);
      if (code === null)
        return reject(new Error(`killed by ${signal ?? "a signal"}`));
      resolve({ code, stdout, stderr });
    });
  });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Argv templates, `{mime}`/`{appId}`/`{file}` substituted per element. */
export interface LaunchConfig {
  default?: string[];
  associations?: string[];
  launch?: string[];
  chooser?: string[];
}

const CONFIG_KEYS = ["default", "associations", "launch", "chooser"] as const;

function configPath(env: NodeJS.ProcessEnv): string {
  const explicit = env.MODEL_BROWSER_LAUNCH_CONFIG;
  if (explicit !== undefined && explicit !== "") return explicit;
  return join(configHome(env), "model-browser", "launch.json");
}

/** Read at startup; an absent or unreadable file leaves the builtins in force. */
export function loadLaunchConfig(
  env: NodeJS.ProcessEnv = process.env,
): LaunchConfig {
  let text: string;
  try {
    text = readFileSync(configPath(env), "utf8");
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const config: LaunchConfig = {};
  for (const key of CONFIG_KEYS) {
    const value = (parsed as Record<string, unknown>)[key];
    // A template is only a template when it is a non-empty argv array of
    // strings; anything else is ignored rather than half-honoured.
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((v) => typeof v === "string")
    ) {
      config[key] = value as string[];
    }
  }
  return config;
}

/** **Per element**, never split or quoted: a file name is one argv entry. */
function fill(argv: readonly string[], vars: Record<string, string>): string[] {
  return argv.map((el) =>
    el.replace(/\{(mime|appId|file)\}/g, (m, k: string) => vars[k] ?? m),
  );
}

// ---------------------------------------------------------------------------
// Desktop entries
// ---------------------------------------------------------------------------

interface DesktopEntry {
  id: string;
  name: string;
  mimes: string[];
  /** `NoDisplay=true` or `Hidden=true` — filtered from associations. */
  hidden: boolean;
  isApplication: boolean;
}

/** `[Desktop Entry]` only, and the first *plain* `Name`: `Name[de]` is a localization. */
function parseEntry(text: string, id: string): DesktopEntry {
  const entry: DesktopEntry = {
    id,
    name: id,
    mimes: [],
    hidden: false,
    isApplication: false,
  };
  let inSection = false;
  let named = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      inSection = line === "[Desktop Entry]";
      continue;
    }
    if (!inSection) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === "Name" && !named && value !== "") {
      entry.name = value;
      named = true;
    } else if (key === "MimeType") {
      entry.mimes = value
        .split(";")
        .map((m) => m.trim())
        .filter((m) => m !== "");
    } else if (key === "NoDisplay" || key === "Hidden") {
      if (value.toLowerCase() === "true") entry.hidden = true;
    } else if (key === "Type") {
      entry.isApplication = value === "Application";
    }
  }
  return entry;
}

/** Comfortably past the deepest live example (wine/Programs/<app>/<app>.desktop). */
const MAX_DEPTH = 8;

/**
 * Every `applications/` dir, earlier winning an id collision. **Stats rather than
 * trusting `withFileTypes`**, a deployed entry often being a symlink (L2), and
 * never `mimeinfo.cache`, which nothing rebuilds for a hand-placed entry.
 */
function scanEntries(env: NodeJS.ProcessEnv): Map<string, DesktopEntry> {
  const found = new Map<string, DesktopEntry>();
  const visited = new Set<string>();

  const walk = (root: string, dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);

    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(dir, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue; // broken symlink
      }
      if (st.isDirectory()) {
        walk(root, full, depth + 1);
        continue;
      }
      if (!st.isFile() || !name.endsWith(".desktop")) continue;
      const id = relative(root, full).split(sep).join("-");
      if (found.has(id)) continue;
      let text: string;
      try {
        text = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      found.set(id, parseEntry(text, id));
    }
  };

  for (const dir of dataDirs(env))
    walk(join(dir, "applications"), join(dir, "applications"), 0);
  return found;
}

/**
 * A dash in an id may or may not be a separator, so: the literal id, then
 * **cumulative** left-to-right dash→`/` substitutions
 * (`wine-Programs-App-App.desktop` needs three at once).
 */
function* idCandidates(id: string): Generator<string> {
  yield id;
  const parts = id.split("-");
  for (let n = 1; n < parts.length; n++) {
    yield `${parts.slice(0, n).join("/")}/${parts.slice(n).join("-")}`;
  }
}

// ---------------------------------------------------------------------------
// mimeapps.list
// ---------------------------------------------------------------------------

type Sections = Map<string, Map<string, string[]>>;

function parseMimeapps(text: string): Sections {
  const sections: Sections = new Map();
  let current: Map<string, string[]> | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      const name = line.slice(1, -1);
      current = sections.get(name) ?? new Map();
      sections.set(name, current);
      continue;
    }
    if (current === undefined) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const mime = line.slice(0, eq).trim();
    const ids = line
      .slice(eq + 1)
      .split(";")
      .map((v) => v.trim())
      .filter((v) => v !== "");
    const prior = current.get(mime);
    current.set(mime, prior === undefined ? ids : [...prior, ...ids]);
  }
  return sections;
}

/** Standard mimeapps.list locations, most precedent first. */
function mimeappsFiles(env: NodeJS.ProcessEnv): string[] {
  return [
    join(configHome(env), "mimeapps.list"),
    ...dataDirs(env).map((d) => join(d, "applications", "mimeapps.list")),
  ];
}

/**
 * `[Removed Associations]` **excludes** (L2). The first location to mention an
 * id decides it, and within one file removals are read first, so an explicit
 * removal beats an addition either way.
 */
function mimeappsDecisions(
  env: NodeJS.ProcessEnv,
  mime: string,
): { added: string[]; removed: Set<string> } {
  const decided = new Map<string, "add" | "remove">();
  const added: string[] = [];
  for (const file of mimeappsFiles(env)) {
    let sections: Sections;
    try {
      sections = parseMimeapps(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    for (const id of sections.get("Removed Associations")?.get(mime) ?? []) {
      if (!decided.has(id)) decided.set(id, "remove");
    }
    const adds = [
      ...(sections.get("Default Applications")?.get(mime) ?? []),
      ...(sections.get("Added Associations")?.get(mime) ?? []),
    ];
    for (const id of adds) {
      if (decided.has(id)) continue;
      decided.set(id, "add");
      added.push(id);
    }
  }
  const removed = new Set(
    [...decided].filter(([, v]) => v === "remove").map(([k]) => k),
  );
  return { added, removed };
}

// ---------------------------------------------------------------------------
// The registry reader
// ---------------------------------------------------------------------------

/** Per request, never memoized (L5): a chooser may rewrite the registry. */
interface Reader {
  name(id: string): string;
  associations(mime: string): AppRef[];
}

function createReader(env: NodeJS.ProcessEnv): Reader {
  let scan: Map<string, DesktopEntry> | undefined;
  const entries = (): Map<string, DesktopEntry> => (scan ??= scanEntries(env));

  const lookup = (id: string): DesktopEntry | undefined => {
    const hit = entries().get(id);
    if (hit !== undefined) return hit;
    // Past the depth cap, or in a dir the scan could not read: probe for it.
    if (id.includes("/") || id.includes("\\") || id.includes(".."))
      return undefined;
    for (const dir of dataDirs(env)) {
      const root = join(dir, "applications");
      for (const rel of idCandidates(id)) {
        const full = join(root, rel);
        try {
          if (!statSync(full).isFile()) continue;
          return parseEntry(readFileSync(full, "utf8"), id);
        } catch {
          // keep trying candidates
        }
      }
    }
    return undefined;
  };

  return {
    // An unresolvable id renders as itself rather than vanishing.
    name: (id) => lookup(id)?.name ?? id,

    associations(mime) {
      const { added, removed } = mimeappsDecisions(env, mime);
      const declaring = [...entries().values()]
        .filter((e) => e.mimes.includes(mime))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => e.id);
      const ordered = [
        ...added,
        ...declaring.filter((id) => !added.includes(id)),
      ];
      const out: AppRef[] = [];
      const seen = new Set<string>();
      for (const id of ordered) {
        if (removed.has(id) || seen.has(id)) continue;
        seen.add(id);
        const entry = lookup(id);
        // Load-bearing, not cosmetic: wine shims and viewer plugins declare the
        // mime and are not applications a user picks.
        if (entry !== undefined && (entry.hidden || !entry.isApplication))
          continue;
        out.push({ id, name: entry?.name ?? id });
      }
      return out;
    },
  };
}

/** Overridden query output: `appId<TAB>name` per line, names the override's job. */
function parseQueryLines(stdout: string): { id: string; name?: string }[] {
  return stdout
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const tab = l.indexOf("\t");
      if (tab === -1) return { id: l.trim() };
      return { id: l.slice(0, tab).trim(), name: l.slice(tab + 1).trim() };
    });
}

// ---------------------------------------------------------------------------
// Zip temp extraction (L7)
// ---------------------------------------------------------------------------

let stagingCounter = 0;

/**
 * Per-run temp store, named from the **full virtual path** (L7): on the basename,
 * two archives' `part.stl` would share a file, and the second launch would
 * overwrite bytes the first application is still reading.
 */
export class ZipTempStore {
  private dir: string | undefined;

  constructor(private readonly root: string = tmpdir()) {}

  /** Created lazily: a server that never opens a zip entry makes no temp dir. */
  private ensureDir(): string {
    return (this.dir ??= mkdtempSync(join(this.root, "model-browser-open-")));
  }

  async fileFor(
    vpath: string,
    zipPath: string,
    entry: string,
  ): Promise<string> {
    const dir = this.ensureDir();
    const hash = createHash("sha256").update(vpath).digest("hex").slice(0, 16);
    const target = join(dir, hash + extname(entry));
    const bytes = await extractEntry(zipPath, entry);
    // Rename, never truncate in place: an application still reading from the
    // previous launch keeps the inode it opened.
    const staging = `${target}.${process.pid}-${stagingCounter++}.part`;
    writeFileSync(staging, bytes);
    renameSync(staging, target);
    return target;
  }
}

// ---------------------------------------------------------------------------
// The launcher
// ---------------------------------------------------------------------------

export interface Launcher {
  /** Whether a chooser template exists — there is no builtin (L2/L4). */
  readonly chooserConfigured: boolean;
  /** Reads the registry fresh; never memoized across calls (L5). */
  report(): Promise<AppsReport>;
  launch(appId: string, file: string): Promise<void>;
  chooser(file: string): Promise<void>;
}

export interface LauncherOptions {
  env?: NodeJS.ProcessEnv;
  exec?: ExecFn;
  /** Injected in tests; otherwise read from disk once, at construction. */
  config?: LaunchConfig;
}

export function createLauncher(opts: LauncherOptions = {}): Launcher {
  const env = opts.env ?? process.env;
  const exec = opts.exec ?? nodeExec;
  const config = opts.config ?? loadLaunchConfig(env);

  async function run(
    argv: string[],
    options: SpawnOptions,
    what: string,
  ): Promise<SpawnResult> {
    let result: SpawnResult;
    try {
      result = await exec(argv[0] as string, argv.slice(1), options);
    } catch (err) {
      throw new LaunchError(`could not run ${what}: ${(err as Error).message}`);
    }
    if (result.code !== 0) {
      const detail = result.stderr.trim();
      throw new LaunchError(
        `${what} exited ${result.code}${detail === "" ? "" : `: ${detail}`}`,
      );
    }
    return result;
  }

  async function queryDefault(
    mime: string,
    reader: Reader,
  ): Promise<AppRef | null> {
    if (config.default !== undefined) {
      const argv = fill(config.default, { mime });
      // A failing query is "no default" for this mime, never a failed report.
      let stdout: string;
      try {
        ({ stdout } = await run(argv, { capture: true }, "the default query"));
      } catch {
        return null;
      }
      const first = parseQueryLines(stdout)[0];
      if (first === undefined) return null;
      return { id: first.id, name: first.name ?? reader.name(first.id) };
    }
    // A missing or failing xdg-mime is "no default", not a failed report.
    let out: SpawnResult;
    try {
      out = await exec("xdg-mime", ["query", "default", mime], {
        capture: true,
      });
    } catch {
      return null;
    }
    if (out.code !== 0) return null;
    const id = out.stdout.split("\n")[0]?.trim() ?? "";
    if (id === "") return null;
    return { id, name: reader.name(id) };
  }

  async function queryAssociations(
    mime: string,
    reader: Reader,
  ): Promise<AppRef[]> {
    if (config.associations !== undefined) {
      const argv = fill(config.associations, { mime });
      let stdout: string;
      try {
        ({ stdout } = await run(
          argv,
          { capture: true },
          "the associations query",
        ));
      } catch {
        return [];
      }
      return parseQueryLines(stdout).map((l) => ({
        id: l.id,
        name: l.name ?? reader.name(l.id),
      }));
    }
    return reader.associations(mime);
  }

  return {
    chooserConfigured: config.chooser !== undefined,

    async report(): Promise<AppsReport> {
      const reader = createReader(env);
      const types: Record<string, TypeApps> = {};
      for (const mime of HANDLED_MIMES) {
        const def = await queryDefault(mime, reader);
        // Reported separately, so these are the *further* apps.
        const associated = (await queryAssociations(mime, reader)).filter(
          (a) => a.id !== def?.id,
        );
        types[mime] = { default: def, associated };
      }
      return { chooser: config.chooser !== undefined, types };
    },

    async launch(appId, file) {
      const argv =
        config.launch !== undefined
          ? fill(config.launch, { appId, file })
          : ["gtk-launch", appId.replace(/\.desktop$/, ""), file];
      await run(argv, {}, "the launch command");
    },

    async chooser(file) {
      if (config.chooser === undefined)
        throw new LaunchError("no chooser is configured");
      // `detached`, and no signal: the chooser blocks on a human decision, and a
      // dismissed one must never read like a killed one (L9).
      await run(
        fill(config.chooser, { file }),
        { detached: true },
        "the chooser command",
      );
    },
  };
}
