/**
 * One file describing this deployment — library, capabilities, origins, address
 * (public-deployment D1/D2). Read **once**, at start, by `index.ts`.
 *
 * Absent is silently `{}`. Anything else unusable — unparseable, invalid, or
 * unreadable for permissions — stops the server, because a file that was
 * authored may be the one carrying the origins and the capabilities. Unknown
 * keys are refused for the same reason: a typo must not be a silent posture.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DeploymentConfig, FeatureReport } from "../../shared/types";
import { DEFAULT_FEATURES } from "./app";
import { configHome, home } from "./xdg";

/** Its message names the file: "the configuration is bad" is otherwise a search. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function configPath(env: NodeJS.ProcessEnv): string {
  const explicit = env.MODEL_BROWSER_CONFIG;
  return explicit !== undefined && explicit !== ""
    ? explicit
    : join(configHome(env), "model-browser", "config.json");
}

/** From the default set, so a new `FeatureReport` field cannot be refused here. */
const FEATURE_KEYS = Object.keys(DEFAULT_FEATURES) as (keyof FeatureReport)[];

const TOP_LEVEL_KEYS = ["root", "origins", "listen", "features"];
const LOOPBACK_HOSTS = ["127.0.0.1", "::1", "localhost"];
const LISTEN_KEYS = ["host", "port"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknown(
  where: string,
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new ConfigError(
        `unknown key ${JSON.stringify(key)} in ${where} (allowed: ${allowed.join(", ")})`,
      );
    }
  }
}

/**
 * `scheme://host[:port]` and nothing else: an origin carrying a path would never
 * match an `Origin` header, so it is refused where it is written.
 */
function checkOrigin(raw: string): void {
  const bad = (why: string): never => {
    throw new ConfigError(
      `origin ${JSON.stringify(raw)} is not scheme://host[:port]: ${why}`,
    );
  };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return bad("not a URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    bad("scheme must be http or https");
  if (url.username !== "" || url.password !== "") bad("carries credentials");
  if (url.search !== "" || url.hash !== "") bad("carries a query or fragment");
  // `new URL` normalises the path to `/`, so the raw string is what tells a bare
  // origin from one written with a trailing slash — and a trailing slash is a path.
  if (url.pathname !== "/" || raw.endsWith("/")) bad("carries a path");
  if (url.hostname === "") bad("names no host");
}

function validate(parsed: unknown): DeploymentConfig {
  if (!isRecord(parsed))
    throw new ConfigError("the file must contain a JSON object");
  rejectUnknown("the configuration", parsed, TOP_LEVEL_KEYS);

  const config: DeploymentConfig = {};

  if (parsed.root !== undefined) {
    if (typeof parsed.root !== "string" || parsed.root === "") {
      throw new ConfigError("root must be a non-empty string");
    }
    config.root = parsed.root;
  }

  if (parsed.origins !== undefined) {
    if (!Array.isArray(parsed.origins))
      throw new ConfigError("origins must be an array of strings");
    for (const entry of parsed.origins) {
      if (typeof entry !== "string")
        throw new ConfigError("origins must be an array of strings");
      checkOrigin(entry);
    }
    config.origins = [...(parsed.origins as string[])];
  }

  if (parsed.listen !== undefined) {
    if (!isRecord(parsed.listen))
      throw new ConfigError("listen must be an object");
    rejectUnknown("listen", parsed.listen, LISTEN_KEYS);
    const listen: { host?: string; port?: number } = {};
    if (parsed.listen.host !== undefined) {
      if (typeof parsed.listen.host !== "string" || parsed.listen.host === "") {
        throw new ConfigError("listen.host must be a non-empty string");
      }
      listen.host = parsed.listen.host;
    }
    if (parsed.listen.port !== undefined) {
      const port = parsed.listen.port;
      if (
        typeof port !== "number" ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535
      ) {
        throw new ConfigError(
          "listen.port must be an integer between 1 and 65535",
        );
      }
      listen.port = port;
    }
    config.listen = listen;
  }

  if (parsed.features !== undefined) {
    if (!isRecord(parsed.features))
      throw new ConfigError("features must be an object");
    rejectUnknown("features", parsed.features, FEATURE_KEYS);
    const features: Partial<FeatureReport> = {};
    for (const key of FEATURE_KEYS) {
      const value = parsed.features[key];
      if (value === undefined) continue;
      if (typeof value !== "boolean")
        throw new ConfigError(`features.${key} must be a boolean`);
      features[key] = value;
    }
    config.features = features;
  }

  // Binding past loopback with no origin answers nobody: the guard would refuse
  // every public request for its `Host`, cleanly and with nothing saying why.
  const host = config.listen?.host;
  if (
    host !== undefined &&
    !LOOPBACK_HOSTS.includes(host) &&
    (config.origins ?? []).length === 0
  ) {
    throw new ConfigError(
      `listen.host ${host} is not loopback and no origins are configured: every API request would be refused`,
    );
  }

  return config;
}

/**
 * `~/` only: `~user/…` needs a passwd lookup and a bare `~` is a directory name.
 * `MODEL_BROWSER_ROOT` is not expanded — the shell already did it.
 */
function expandRoot(root: string, env: NodeJS.ProcessEnv): string {
  return root.startsWith("~/") ? join(home(env), root.slice(2)) : root;
}

/**
 * `MODEL_BROWSER_ROOT` overrides the `root` key **in the returned value** and
 * nothing else, so every consumer reads one resolved root (D2).
 */
export async function loadConfig(
  env: NodeJS.ProcessEnv,
): Promise<DeploymentConfig> {
  const file = configPath(env);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT")
      return withRootFromEnv({}, env);
    throw new ConfigError(
      `${file} could not be read: ${(err as Error).message}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(
      `${file} is not valid JSON: ${(err as Error).message}`,
    );
  }
  let config: DeploymentConfig;
  try {
    config = validate(parsed);
  } catch (err) {
    throw new ConfigError(
      `${file} is not a valid configuration: ${(err as Error).message}`,
    );
  }
  if (config.root !== undefined) config.root = expandRoot(config.root, env);
  return withRootFromEnv(config, env);
}

function withRootFromEnv(
  config: DeploymentConfig,
  env: NodeJS.ProcessEnv,
): DeploymentConfig {
  const fromEnv = env.MODEL_BROWSER_ROOT;
  return fromEnv !== undefined && fromEnv !== ""
    ? { ...config, root: fromEnv }
    : config;
}
