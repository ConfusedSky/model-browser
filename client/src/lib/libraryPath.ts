/**
 * A library path expanded to the filesystem path it names (library R2).
 *
 * Every path this app handles is library-relative with a leading slash — wire,
 * URL, recents, path bar, cache key (design D2). This is the one exception the
 * spec carves out, and it is narrow on purpose: the two places a path *leaves*
 * the app for another program to open, namely the copy-path command and the
 * lightbox's file details. Nothing else expands, because nothing else is read
 * outside this app.
 *
 * The `!/` notation survives, and it survives *by construction* rather than by
 * luck: an archive entry's name is opaque and must not be rewritten — the rule
 * `library.resolve` follows on the server (design D3), which splits the virtual
 * path first and normalises the filesystem half alone. The same split here
 * means a later edit that starts normalising can only ever touch the half that
 * is a filesystem path. One `!/`, never nested (architecture D6), so one split
 * is the whole grammar.
 *
 * `top` is null while the library is not `ready`: there is no top to join onto,
 * so the library path is handed over as it stands rather than decorated with a
 * guess at where the volume would have been mounted.
 *
 * No `node:path` — this is the client, where `posix.join` is not reachable. The
 * join is a concatenation with the duplicate separator removed: every library
 * path opens with a slash, so a `top` that closes with one would double it.
 */
export function expandLibraryPath(top: string | null, path: string): string {
  if (top === null) return path
  const base = top.endsWith('/') ? top.slice(0, -1) : top
  const sep = path.indexOf('!/')
  const fs = sep === -1 ? path : path.slice(0, sep)
  const entry = sep === -1 ? '' : path.slice(sep)
  // The library's top is `/`, so it names the top itself rather than a child —
  // and a library mounted *at* the filesystem root leaves `base` empty, where
  // the answer is the root's own spelling and not the empty string.
  const joined = fs === '/' ? base : base + fs
  return (joined === '' ? '/' : joined) + entry
}
