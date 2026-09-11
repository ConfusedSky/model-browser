/**
 * frame-ab page (`file-frame-spindle` D6; `scripts/frame-ab/README.md`).
 *
 * Renders one model through the app's own `renderThumbnailCanvas` — the same
 * staging, chain and readback as every thumbnail, minus the WebP encode — and
 * hands the driver (`scripts/frame-ab/run.mjs`) lossless PNGs to compare
 * against the stored baselines. There are no runtime switches of its own: what
 * renders is whatever the app's modules do today — except `legacy`, which is
 * the app's own compare-pill flag (`bakeToggle.ts`, D7) and goes with it.
 *
 * Not part of the app and never built: `vite.config.ts` names no rollup input,
 * so `vite build` bundles `client/index.html` alone. The dev server serves it
 * (`bunx vite --port 5174 --strictPort` from `client/`) because it imports the
 * app's modules through Vite; it typechecks because `spike` is in
 * `tsconfig.json`'s `include`.
 */
import type { CameraState, IndexPose, OrbitAxis } from '../../shared/types'
import { migrateAxis, swapOffset } from '../../shared/frames'
// TEMPORARY — deleted by file-frame-spindle 5.2 (with `RenderOpts.legacy`).
import { setLegacyBake } from '../src/three/bakeToggle'
import { DEFAULT_CAMERA, defaultAxisFor } from '../src/three/camera'
import { formatOf, parseModel, type ModelFormat } from '../src/three/models'
import { cameraForPose } from '../src/three/pose'
import { renderThumbnailCanvas, THUMB_SIZE } from '../src/three/renderer'

/**
 * The opaque ground every comparison is composited over — the spike's
 * contact-sheet cell colour. A thumbnail is transparent outside the model, and
 * a canvas stores premultiplied alpha, so raw RGBA disagrees with what any
 * viewer shows where alpha is low; compositing both sides over the same ground
 * compares the picture a viewer sees (task 0.1 found the raw-vs-cell mismatch).
 */
const GROUND = '#3a3a40'

interface RenderOpts {
  /** Library path — the fetch key for `/api/file`, the parse-cache key, and what `format` is read from when absent. */
  path: string
  format?: ModelFormat
  /** The model's bytes when the caller has them; else `text` (a generated fixture); else fetched at `/api/file?path=` through Vite's proxy. */
  bytes?: ArrayBuffer
  text?: string
  /** Spindle, in the file's own axes; the format's default when absent. A `pose` overrides it. */
  axis?: OrbitAxis
  camera?: CameraState
  /** Derived through `cameraForPose` when no `camera` is given — the app's own pose path. */
  pose?: IndexPose
  ao?: boolean
  /**
   * TEMPORARY — deleted by file-frame-spindle 5.2. Render the pre-change
   * convention (the spike's C0) through the compare pill's flag: the STL bake
   * applied at parse, `frameFor`'s legacy scene table, the pose read's scene
   * mapping. The framing given is then taken **as the legacy one** — a recorded
   * scene axis as-is (no `migrateAxis`), a stored camera as-is, a pose through
   * `cameraForPose` under the flag. An `axis` or a `pose` is required: there is
   * no legacy default to fall back on.
   */
  legacy?: boolean
}

interface RenderResult {
  /** The framing actually rendered under, so the driver can check it against the record. */
  axis: OrbitAxis
  camera: CameraState
  /** The canvas, lossless. */
  pngDataUrl: string
}

interface Comparison {
  /** Pixels where any of the four channels differs, after compositing over `GROUND`. */
  diff: number
  /** The largest channel delta anywhere, 0–255. */
  max: number
  pixels: number
}

interface SheetCell {
  label: string
  pngDataUrl: string
}

const bytesCache = new Map<string, ArrayBuffer>()
const modelCache = new Map<string, ReturnType<typeof parseModel>>()
// TEMPORARY — deleted by file-frame-spindle 5.2: the baked parses, apart.
const legacyModelCache = new Map<string, ReturnType<typeof parseModel>>()

async function bytesFor(opts: RenderOpts): Promise<ArrayBuffer> {
  if (opts.bytes !== undefined) return opts.bytes
  if (opts.text !== undefined) return new TextEncoder().encode(opts.text).buffer as ArrayBuffer
  const hit = bytesCache.get(opts.path)
  if (hit !== undefined) return hit
  const res = await fetch(`/api/file?path=${encodeURIComponent(opts.path)}`)
  if (!res.ok) throw new Error(`fetch ${opts.path}: ${res.status}`)
  const buf = await res.arrayBuffer()
  bytesCache.set(opts.path, buf)
  return buf
}

function formatFor(opts: RenderOpts): ModelFormat {
  const format = opts.format ?? formatOf(opts.path)
  if (format === null) throw new Error(`no model format for ${opts.path}`)
  return format
}

async function render(opts: RenderOpts): Promise<RenderResult> {
  const format = formatFor(opts)
  const legacy = opts.legacy === true
  const bytes = await bytesFor(opts)
  // TEMPORARY — deleted by file-frame-spindle 5.2: the flag is on from the
  // parse through the readback — `parseModel`'s bake, `cameraForPose`'s scene
  // mapping and `frameFor`'s table all read it — and off again before anything
  // else on this page can render. Nothing here is async while it is set.
  if (legacy) {
    if (opts.axis === undefined && opts.pose === undefined) throw new Error(`legacy render of ${opts.path} needs an axis or a pose`)
    setLegacyBake(true)
  }
  try {
    const cache = legacy ? legacyModelCache : modelCache
    let object = cache.get(opts.path)
    if (object === undefined) {
      object = parseModel(bytes, format, legacy)
      cache.set(opts.path, object)
    }
    let axis = opts.axis ?? defaultAxisFor(format)
    let camera = opts.camera ?? DEFAULT_CAMERA
    if (opts.camera === undefined && opts.pose !== undefined) {
      const derived = cameraForPose(opts.pose, DEFAULT_CAMERA)
      if (derived === null) throw new Error(`cameraForPose returned null for ${opts.path}`)
      axis = derived.axis
      camera = derived.camera
    }
    const canvas = renderThumbnailCanvas(object, camera, axis, opts.ao ?? true)
    return { axis, camera, pngDataUrl: canvas.toDataURL('image/png') }
  } finally {
    if (legacy) setLegacyBake(false)
  }
}

async function decode(pngDataUrl: string): Promise<HTMLImageElement> {
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('PNG decode failed'))
    img.src = pngDataUrl
  })
  return img
}

/** The PNG composited over `GROUND`, as opaque RGBA. */
async function composited(pngDataUrl: string): Promise<Uint8ClampedArray> {
  const img = await decode(pngDataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('2d context unavailable')
  ctx.fillStyle = GROUND
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data
}

async function compare(pngA: string, pngB: string): Promise<Comparison> {
  const [A, B] = await Promise.all([composited(pngA), composited(pngB)])
  if (A.length !== B.length) throw new Error(`size mismatch: ${A.length / 4} vs ${B.length / 4} pixels`)
  let diff = 0
  let max = 0
  for (let i = 0; i < A.length; i += 4) {
    let d = 0
    for (let c = 0; c < 4; c++) {
      const delta = Math.abs(A[i + c]! - B[i + c]!)
      if (delta > d) d = delta
    }
    if (d > 0) diff++
    if (d > max) max = d
  }
  return { diff, max, pixels: A.length / 4 }
}

/** Contact sheet: labelled cells side by side, each composited over `GROUND`. */
async function sheet(cells: SheetCell[], title: string): Promise<string> {
  const cell = THUMB_SIZE
  const pad = 8
  const head = 22
  const canvas = document.createElement('canvas')
  canvas.width = cells.length * (cell + pad) + pad
  canvas.height = cell + pad * 2 + head * 2
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('2d context unavailable')
  ctx.fillStyle = '#202024'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#e8e8ea'
  ctx.font = '14px monospace'
  ctx.fillText(title, pad, 16)
  const images = await Promise.all(cells.map((c) => decode(c.pngDataUrl)))
  cells.forEach((c, i) => {
    const x = pad + i * (cell + pad)
    const y = head + pad
    ctx.fillStyle = GROUND
    ctx.fillRect(x, y, cell, cell)
    ctx.drawImage(images[i]!, x, y)
    ctx.fillStyle = '#e8e8ea'
    ctx.fillText(c.label, x, y + cell + 16)
  })
  return canvas.toDataURL('image/png')
}

declare global {
  interface Window {
    ab: {
      render: typeof render
      compare: typeof compare
      sheet: typeof sheet
      /** `shared/frames`: the file axis a baseline's recorded scene axis names. */
      migrateAxis: typeof migrateAxis
      /** `shared/frames`: radians a never-baked format's stored `az` gains under the new table. */
      swapOffset: typeof swapOffset
      defaultCamera: CameraState
      thumbSize: number
    }
  }
}

window.ab = {
  render,
  compare,
  sheet,
  migrateAxis,
  swapOffset,
  defaultCamera: DEFAULT_CAMERA,
  thumbSize: THUMB_SIZE,
}
const status = document.getElementById('status')
if (status !== null) status.textContent = 'ab ready'
