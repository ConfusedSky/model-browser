export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Largest centered square inside a box — where a square thumbnail would sit.
 * Used as the orbit-overlay rect when a tile has no rendered <img> yet; when
 * one exists, its own rect IS the image box (512×512 intrinsic scaled
 * uniformly by max-constraints), which is why overlay aspect is always 1 and
 * framing matches the thumbnail camera exactly.
 */
export function fitSquareBox(box: Box): Box {
  const side = Math.min(box.width, box.height)
  return {
    left: box.left + (box.width - side) / 2,
    top: box.top + (box.height - side) / 2,
    width: side,
    height: side,
  }
}
