/** `getThumb`'s query shape, so an `<img>` and the JSON lookup name the same
 *  bytes in the same cache tier (D1). A pure function beside `ApiClient`, so a
 *  faked client can use the real builder rather than a copy. */
export function thumbImageUrl(
  path: string,
  mtime: number,
  ao: boolean,
  gen?: number,
): string {
  return `/api/thumb/image?path=${encodeURIComponent(path)}&mtime=${mtime}${ao ? "" : "&ao=off"}${gen !== undefined ? `&gen=${gen}` : ""}`;
}
