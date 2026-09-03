/**
 * The image route's URL for one render (`thumbnail-image-serving` D1): the
 * same query shape `getThumb` sends, so the URL an `<img>` fetches and the URL
 * the JSON lookup fetches name the same bytes and land in the same cache tier.
 * `ao` is appended only when off and `gen` only when known, exactly as the
 * lookup appends them, for the same reason: a request that names nothing is
 * byte-identical to what a client sent before either existed.
 *
 * A pure function beside `ApiClient` rather than only a method on it, so the
 * test harness that fakes the client can use the real builder instead of a
 * copy that would drift from it.
 */
export function thumbImageUrl(path: string, mtime: number, ao: boolean, gen?: number): string {
  return `/api/thumb/image?path=${encodeURIComponent(path)}&mtime=${mtime}${ao ? '' : '&ao=off'}${gen !== undefined ? `&gen=${gen}` : ''}`
}
