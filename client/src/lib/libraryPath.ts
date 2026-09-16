/**
 * The one place a library path becomes a filesystem path (library R2). The split
 * keeps the `!/` half opaque, as `library.resolve` does on the server (D3), so a
 * later edit that normalises can only touch the filesystem half. Without a
 * `top`, the library path is handed over as it stands.
 */
export function expandLibraryPath(top: string | null, path: string): string {
  if (top === null) return path;
  const base = top.endsWith("/") ? top.slice(0, -1) : top;
  const sep = path.indexOf("!/");
  const fs = sep === -1 ? path : path.slice(0, sep);
  const entry = sep === -1 ? "" : path.slice(sep);
  // `/` names the top itself, and a library mounted at the filesystem root
  // leaves `base` empty, where the answer is `/` rather than the empty string.
  const joined = fs === "/" ? base : base + fs;
  return (joined === "" ? "/" : joined) + entry;
}
