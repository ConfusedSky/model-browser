/**
 * XDG base-directory locations. `env` is a parameter, not a `process.env` read,
 * so a test can point the whole chain at a temp tree.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export function home(env: NodeJS.ProcessEnv): string {
  const h = env.HOME;
  return h !== undefined && h !== "" ? h : homedir();
}

export function configHome(env: NodeJS.ProcessEnv): string {
  const c = env.XDG_CONFIG_HOME;
  return c !== undefined && c !== "" ? c : join(home(env), ".config");
}

/**
 * Data dirs in precedence order, **defaults applied**: a desktop commonly leaves
 * `~/.local/share` out of both variables, and that is where the entries are (L2).
 */
export function dataDirs(env: NodeJS.ProcessEnv): string[] {
  const dataHome = env.XDG_DATA_HOME;
  const first =
    dataHome !== undefined && dataHome !== ""
      ? dataHome
      : join(home(env), ".local", "share");
  const rest = env.XDG_DATA_DIRS;
  const dirs = (
    rest !== undefined && rest !== "" ? rest : "/usr/local/share:/usr/share"
  )
    .split(":")
    .filter((d) => d !== "");
  const seen = new Set<string>();
  return [first, ...dirs].filter((d) =>
    seen.has(d) ? false : (seen.add(d), true),
  );
}
