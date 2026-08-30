import { describe, expect, it } from 'vitest'
import { expandLibraryPath } from '../src/lib/libraryPath'

describe('expandLibraryPath', () => {
  it('joins the library top onto a library path', () => {
    expect(expandLibraryPath('/lib', '/Kit/a.stl')).toBe('/lib/Kit/a.stl')
    expect(expandLibraryPath('/run/media/masa/STL Library', '/Loot/x.stl')).toBe(
      '/run/media/masa/STL Library/Loot/x.stl',
    )
  })

  it('keeps the `!/` notation, entry name untouched', () => {
    // The archive entry's name is opaque and must not be rewritten (design D3);
    // only the filesystem half is joined. One `!/`, never nested (D6).
    expect(expandLibraryPath('/lib', '/Kit/parts.zip!/lid.stl')).toBe(
      '/lib/Kit/parts.zip!/lid.stl',
    )
    expect(expandLibraryPath('/lib', '/Kit/parts.zip!/inner dir/part v2.stl')).toBe(
      '/lib/Kit/parts.zip!/inner dir/part v2.stl',
    )
    // The archive itself, with no entry named, joins like any other path.
    expect(expandLibraryPath('/lib', '/Kit/parts.zip')).toBe('/lib/Kit/parts.zip')
  })

  it('names the top itself for the root path', () => {
    expect(expandLibraryPath('/lib', '/')).toBe('/lib')
  })

  it('does not double the separator when the top ends in one', () => {
    expect(expandLibraryPath('/lib/', '/Kit/a.stl')).toBe('/lib/Kit/a.stl')
    expect(expandLibraryPath('/lib/', '/')).toBe('/lib')
    expect(expandLibraryPath('/lib/', '/Kit/a.zip!/x.stl')).toBe('/lib/Kit/a.zip!/x.stl')
  })

  it('answers the root’s own spelling for a library mounted at /', () => {
    // The join leaves nothing in front of the path, and the empty string is not
    // a path — the filesystem root is spelled `/`.
    expect(expandLibraryPath('/', '/')).toBe('/')
    expect(expandLibraryPath('/', '/Kit/a.stl')).toBe('/Kit/a.stl')
  })

  it('hands back the library path unchanged when there is no top', () => {
    // Not `ready`: nothing is known about where the volume would be mounted, so
    // nothing is invented. A guessed prefix would name a real file elsewhere.
    expect(expandLibraryPath(null, '/Kit/a.stl')).toBe('/Kit/a.stl')
    expect(expandLibraryPath(null, '/Kit/a.zip!/x.stl')).toBe('/Kit/a.zip!/x.stl')
    expect(expandLibraryPath(null, '/')).toBe('/')
  })
})
