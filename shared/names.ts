/**
 * File name of an entry name. Flat and deep-search listings name a model by
 * its path relative to the walk root (`dir/foo.stl`, `a.zip!/inner/b.stl`);
 * nested listings name it by the file alone, where this is the identity.
 *
 * Shared so the flat sort order (server) and the tile label (client) cannot
 * drift apart — flat results are ordered by this, so same-named parts sit
 * together in the grid.
 */
export function baseName(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1)
}
