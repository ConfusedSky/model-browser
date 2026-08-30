/**
 * XDG base-directory locations, shared by every module that reads a file the
 * user placed on this machine (`launch.json`, `config.json`, `mimeapps.list`).
 *
 * Node APIs only — the Hono app must run un-Bun'd (global D1).
 *
 * The `env` is a parameter rather than a read of `process.env`, so a test can
 * point the whole chain at a temp tree without mutating the process.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

export function home(env: NodeJS.ProcessEnv): string {
  const h = env.HOME
  return h !== undefined && h !== '' ? h : homedir()
}

export function configHome(env: NodeJS.ProcessEnv): string {
  const c = env.XDG_CONFIG_HOME
  return c !== undefined && c !== '' ? c : join(home(env), '.config')
}

/**
 * Data dirs in precedence order, **with the XDG defaults applied**. Reading
 * the variables literally is not equivalent: on the development machine
 * `XDG_DATA_HOME` is unset and `~/.local/share` is absent from
 * `XDG_DATA_DIRS` (verified), so the literal read misses the one directory
 * holding every entry that matters (L2).
 */
export function dataDirs(env: NodeJS.ProcessEnv): string[] {
  const dataHome = env.XDG_DATA_HOME
  const first = dataHome !== undefined && dataHome !== '' ? dataHome : join(home(env), '.local', 'share')
  const rest = env.XDG_DATA_DIRS
  const dirs = (rest !== undefined && rest !== '' ? rest : '/usr/local/share:/usr/share')
    .split(':')
    .filter((d) => d !== '')
  const seen = new Set<string>()
  return [first, ...dirs].filter((d) => (seen.has(d) ? false : (seen.add(d), true)))
}
