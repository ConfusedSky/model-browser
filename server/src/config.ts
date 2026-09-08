/**
 * The deployment's configuration file: one file describing this deployment —
 * its library, its capabilities, its origins, its address (public-deployment
 * D1/D2).
 *
 * Node APIs only — the Hono app must run un-Bun'd (global D1).
 *
 * Read **once**, at server start, by `index.ts`. Nothing here is re-read: the
 * library keeps re-asking the *filesystem* while it is unsettled, so a volume
 * mounted after start still needs no restart, but the file gets exactly one
 * moment at which it can be found malformed — which is what makes "a malformed
 * file stops the server" mean anything.
 *
 * Three outcomes, and the distinction between the first two is the point:
 *
 * - **Absent** → `{}`, silently. Running with no configuration is the ordinary
 *   case.
 * - **Present but unreadable, unparseable or invalid** → `ConfigError`, naming
 *   the file and the reason, and the server does not start. The file was
 *   authored; a misread one may have been the one carrying the origin and the
 *   capabilities, so falling back to the defaults would serve under a posture
 *   nobody chose. Unreadable-for-permissions is treated as malformed rather
 *   than absent for exactly that reason.
 * - **Valid** → the parsed configuration.
 *
 * Validation is strict at both levels, and there is no free-text key. An
 * unknown key is a failure, not a line to skip: a typo silently ignored is the
 * same disease the loud failure exists to cure.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DeploymentConfig, FeatureReport } from '../../shared/types'
import { DEFAULT_FEATURES } from './app'
import { configHome, home } from './xdg'

/**
 * A configuration file that was authored and cannot be used. Its message names
 * the file, because "the configuration is bad" without a path is a search.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/** Which file: the explicit one, else `config.json` under the XDG config home. */
export function configPath(env: NodeJS.ProcessEnv): string {
  const explicit = env.MODEL_BROWSER_CONFIG
  return explicit !== undefined && explicit !== ''
    ? explicit
    : join(configHome(env), 'model-browser', 'config.json')
}

/**
 * The capability names the file may carry, taken from the default set itself
 * rather than re-listed here — a field added to `FeatureReport` is then
 * declarable the moment it has a default, and can never be refused by a parser
 * that was not updated with it.
 */
const FEATURE_KEYS = Object.keys(DEFAULT_FEATURES) as (keyof FeatureReport)[]

const TOP_LEVEL_KEYS = ['root', 'origins', 'listen', 'features']
/** The addresses the guard admits whatever is configured (`guard.ts`). */
const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost']
const LISTEN_KEYS = ['host', 'port']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The unknown-key rule, spelt once for the three objects that have one. */
function rejectUnknown(where: string, value: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new ConfigError(`unknown key ${JSON.stringify(key)} in ${where} (allowed: ${allowed.join(', ')})`)
    }
  }
}

/**
 * `scheme://host[:port]`, and nothing else — no path, no query, no fragment, no
 * credentials. An origin carrying a path is not an origin, and comparing one
 * against an `Origin` header would never match, so it is refused where it is
 * written rather than silently never matching at runtime.
 */
function checkOrigin(raw: string): void {
  const bad = (why: string): never => {
    throw new ConfigError(`origin ${JSON.stringify(raw)} is not scheme://host[:port]: ${why}`)
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return bad('not a URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') bad('scheme must be http or https')
  if (url.username !== '' || url.password !== '') bad('carries credentials')
  if (url.search !== '' || url.hash !== '') bad('carries a query or fragment')
  // `new URL('https://h')` normalises the path to `/`, so a bare origin and one
  // written with a trailing slash both land here; only the latter has the
  // slash in the string it was written as, and a trailing slash is a path.
  if (url.pathname !== '/' || raw.endsWith('/')) bad('carries a path')
  if (url.hostname === '') bad('names no host')
}

/** Everything the file may say, checked before any of it is believed. */
function validate(parsed: unknown): DeploymentConfig {
  if (!isRecord(parsed)) throw new ConfigError('the file must contain a JSON object')
  rejectUnknown('the configuration', parsed, TOP_LEVEL_KEYS)

  const config: DeploymentConfig = {}

  if (parsed.root !== undefined) {
    if (typeof parsed.root !== 'string' || parsed.root === '') {
      throw new ConfigError('root must be a non-empty string')
    }
    config.root = parsed.root
  }

  if (parsed.origins !== undefined) {
    if (!Array.isArray(parsed.origins)) throw new ConfigError('origins must be an array of strings')
    for (const entry of parsed.origins) {
      if (typeof entry !== 'string') throw new ConfigError('origins must be an array of strings')
      checkOrigin(entry)
    }
    config.origins = [...(parsed.origins as string[])]
  }

  if (parsed.listen !== undefined) {
    if (!isRecord(parsed.listen)) throw new ConfigError('listen must be an object')
    rejectUnknown('listen', parsed.listen, LISTEN_KEYS)
    const listen: { host?: string; port?: number } = {}
    if (parsed.listen.host !== undefined) {
      if (typeof parsed.listen.host !== 'string' || parsed.listen.host === '') {
        throw new ConfigError('listen.host must be a non-empty string')
      }
      listen.host = parsed.listen.host
    }
    if (parsed.listen.port !== undefined) {
      const port = parsed.listen.port
      if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new ConfigError('listen.port must be an integer between 1 and 65535')
      }
      listen.port = port
    }
    config.listen = listen
  }

  if (parsed.features !== undefined) {
    if (!isRecord(parsed.features)) throw new ConfigError('features must be an object')
    rejectUnknown('features', parsed.features, FEATURE_KEYS)
    const features: Partial<FeatureReport> = {}
    for (const key of FEATURE_KEYS) {
      const value = parsed.features[key]
      if (value === undefined) continue
      if (typeof value !== 'boolean') throw new ConfigError(`features.${key} must be a boolean`)
      features[key] = value
    }
    config.features = features
  }

  // A deployment that binds past loopback and names no origin answers nobody:
  // the guard admits loopback and the configured origins, so every request
  // arriving at the public address is refused for its `Host` — a box that
  // starts clean and 403s every visitor, with nothing anywhere saying why.
  // Caught here, at start, where the operator is still watching, and by the
  // same rule that makes a malformed file stop the server.
  const host = config.listen?.host
  if (host !== undefined && !LOOPBACK_HOSTS.includes(host) && (config.origins ?? []).length === 0) {
    throw new ConfigError(
      `listen.host ${host} is not loopback and no origins are configured: every API request would be refused`,
    )
  }

  return config
}

/**
 * A `root` written with a leading `~/` names the running user's home, which is
 * how it is written in a config file by hand and what the shell would have done
 * to it on a command line. Exactly that prefix: `~user/…` is another user's
 * home, which needs a passwd lookup this app does not do, and a bare `~` is a
 * directory whose name is a tilde — both are left as written, so a path that is
 * not expanded is not silently pointed somewhere else either.
 *
 * `MODEL_BROWSER_ROOT` is **not** expanded: it comes from an environment, where
 * the shell already did this, and expanding a second time would rewrite a real
 * path that happens to begin with a tilde.
 */
function expandRoot(root: string, env: NodeJS.ProcessEnv): string {
  return root.startsWith('~/') ? join(home(env), root.slice(2)) : root
}

/**
 * The configuration this process runs on.
 *
 * `MODEL_BROWSER_ROOT` overrides the `root` key **in the returned value**, so
 * every consumer reads one resolved root rather than each re-applying the
 * precedence — and, unlike before, it no longer returns before the file is
 * read: it overrides that one key and nothing else (D2).
 */
export async function loadConfig(env: NodeJS.ProcessEnv): Promise<DeploymentConfig> {
  const file = configPath(env)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return withRootFromEnv({}, env)
    throw new ConfigError(`${file} could not be read: ${(err as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new ConfigError(`${file} is not valid JSON: ${(err as Error).message}`)
  }
  let config: DeploymentConfig
  try {
    config = validate(parsed)
  } catch (err) {
    throw new ConfigError(`${file} is not a valid configuration: ${(err as Error).message}`)
  }
  if (config.root !== undefined) config.root = expandRoot(config.root, env)
  return withRootFromEnv(config, env)
}

function withRootFromEnv(config: DeploymentConfig, env: NodeJS.ProcessEnv): DeploymentConfig {
  const fromEnv = env.MODEL_BROWSER_ROOT
  return fromEnv !== undefined && fromEnv !== '' ? { ...config, root: fromEnv } : config
}
