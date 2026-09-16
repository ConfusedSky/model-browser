export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The orbit-overlay rect for a tile with no rendered `<img>` yet; where one
 * exists its own rect *is* the image box, which is why the overlay's aspect is
 * always 1 and its framing matches the thumbnail camera exactly.
 */
export function fitSquareBox(box: Box): Box {
  const side = Math.min(box.width, box.height);
  return {
    left: box.left + (box.width - side) / 2,
    top: box.top + (box.height - side) / 2,
    width: side,
    height: side,
  };
}
