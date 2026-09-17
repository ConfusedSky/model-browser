/**
 * STL → GLB and back, as a matched pair (server-glb-cache D3/D4). The server
 * serves an STL model's geometry as an indexed, position-only GLB; the client
 * reads exactly this container. No `three` import — `shared/` is compiled by a
 * server that depends on `hono` and `fflate` alone.
 *
 * The GLB carries positions and indices and **no normals**: the client
 * de-indexes and recomputes flat facet normals from winding, so the geometry it
 * shades from is byte-for-byte today's STL parse. Vertices are welded by the
 * exact float32 bit pattern of their coordinates, so no coordinate ever moves.
 */

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"
const COMP_FLOAT = 5126;
const COMP_USHORT = 5123;
const COMP_UINT = 5125;
const TARGET_ARRAY_BUFFER = 34962;
const TARGET_ELEMENT_ARRAY_BUFFER = 34963;

/** uint16 indices while the vertex count fits its range (max index 65535). */
const UINT16_LIMIT = 65536;

export class GlbError extends Error {}

/** Triangle vertices, three float32 coordinates each, in file order. */
interface Triangles {
  /** `count * 9` float32 values: v0x v0y v0z v1x … for each triangle. */
  coords: Float32Array;
  count: number;
}

/** Detected the way `STLLoader` does: an 80-byte header, a uint32 face count,
 *  then `50 * n` bytes of facets — so `84 + 50·n` is the whole file. Anything
 *  else is parsed as ASCII, so a file the client renders today still renders. */
function parseStl(bytes: ArrayBuffer): Triangles {
  if (bytes.byteLength >= 84) {
    const view = new DataView(bytes);
    const n = view.getUint32(80, true);
    if (84 + 50 * n === bytes.byteLength) return parseBinary(view, n);
  }
  return parseAscii(bytes);
}

function parseBinary(view: DataView, n: number): Triangles {
  const coords = new Float32Array(n * 9);
  let o = 0;
  for (let i = 0; i < n; i++) {
    // Skip the 12-byte facet normal (the viewer recomputes it) and the 2-byte
    // attribute count after the nine vertex floats.
    let p = 84 + i * 50 + 12;
    for (let k = 0; k < 9; k++, p += 4) coords[o++] = view.getFloat32(p, true);
  }
  return { coords, count: n };
}

function parseAscii(bytes: ArrayBuffer): Triangles {
  const text = new TextDecoder().decode(bytes);
  const nums: number[] = [];
  // Every `vertex x y z` line, in document order — three per facet, unindexed.
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    nums.push(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  if (nums.length === 0 || nums.length % 9 !== 0) {
    throw new GlbError("not an STL: no triangles found");
  }
  return { coords: Float32Array.from(nums), count: nums.length / 9 };
}

/** Convert an STL model to an indexed, position-only binary GLB. */
export function stlToGlb(bytes: ArrayBuffer): ArrayBuffer {
  const { coords, count } = parseStl(bytes);
  if (count === 0) throw new GlbError("empty STL: no triangles");

  // Weld by the exact float32 bits of the three coordinates. The scratch
  // Float32Array canonicalises each coordinate to float32 before hashing, so a
  // binary STL's stored bits and an ASCII STL's parsed value key identically.
  const scratch = new ArrayBuffer(12);
  const sf = new Float32Array(scratch);
  const su = new Uint32Array(scratch);
  const index = new Map<string, number>();
  const positions: number[] = [];
  const indices = new Array<number>(count * 3);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < count * 3; i++) {
    sf[0] = coords[i * 3]!;
    sf[1] = coords[i * 3 + 1]!;
    sf[2] = coords[i * 3 + 2]!;
    const key = `${su[0]},${su[1]},${su[2]}`;
    let vi = index.get(key);
    if (vi === undefined) {
      vi = positions.length / 3;
      index.set(key, vi);
      // Push the float32-canonical values, so positions match the weld key.
      const cx = sf[0]!,
        cy = sf[1]!,
        cz = sf[2]!;
      positions.push(cx, cy, cz);
      if (cx < min[0]!) min[0] = cx;
      if (cx > max[0]!) max[0] = cx;
      if (cy < min[1]!) min[1] = cy;
      if (cy > max[1]!) max[1] = cy;
      if (cz < min[2]!) min[2] = cz;
      if (cz > max[2]!) max[2] = cz;
    }
    indices[i] = vi;
  }

  const vertCount = positions.length / 3;
  const idxCount = indices.length;
  const uint16 = vertCount <= UINT16_LIMIT;
  const posBytes = vertCount * 12;
  const idxBytes = idxCount * (uint16 ? 2 : 4);

  const json = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: posBytes + idxBytes }],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: 0,
        byteLength: posBytes,
        target: TARGET_ARRAY_BUFFER,
      },
      {
        buffer: 0,
        byteOffset: posBytes,
        byteLength: idxBytes,
        target: TARGET_ELEMENT_ARRAY_BUFFER,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: COMP_FLOAT,
        count: vertCount,
        type: "VEC3",
        min,
        max,
      },
      {
        bufferView: 1,
        componentType: uint16 ? COMP_USHORT : COMP_UINT,
        count: idxCount,
        type: "SCALAR",
      },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };

  const bin = new ArrayBuffer(posBytes + idxBytes);
  const pf = new Float32Array(bin, 0, vertCount * 3);
  for (let i = 0; i < positions.length; i++) pf[i] = positions[i]!;
  // posBytes is a multiple of 12, so the index view is aligned for both widths.
  const iv = uint16
    ? new Uint16Array(bin, posBytes, idxCount)
    : new Uint32Array(bin, posBytes, idxCount);
  for (let i = 0; i < idxCount; i++) iv[i] = indices[i]!;

  return assembleGlb(json, bin);
}

/** Pack JSON and BIN into a GLB. The JSON chunk pads with spaces, the BIN chunk
 *  with zeros, each to a 4-byte boundary (glTF §4.4.3). */
function assembleGlb(json: unknown, bin: ArrayBuffer): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
  const binPad = (4 - (bin.byteLength % 4)) % 4;
  const jsonLen = jsonBytes.byteLength + jsonPad;
  const binLen = bin.byteLength + binPad;
  const total = 12 + 8 + jsonLen + 8 + binLen;

  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  const u8 = new Uint8Array(out);
  let p = 0;
  view.setUint32(p, GLB_MAGIC, true);
  view.setUint32(p + 4, 2, true);
  view.setUint32(p + 8, total, true);
  p += 12;
  view.setUint32(p, jsonLen, true);
  view.setUint32(p + 4, CHUNK_JSON, true);
  p += 8;
  u8.set(jsonBytes, p);
  for (let i = 0; i < jsonPad; i++) u8[p + jsonBytes.byteLength + i] = 0x20;
  p += jsonLen;
  view.setUint32(p, binLen, true);
  view.setUint32(p + 4, CHUNK_BIN, true);
  p += 8;
  u8.set(new Uint8Array(bin), p);
  // The BIN pad is already zero from the fresh ArrayBuffer.
  return out;
}

export interface GlbGeometry {
  positions: Float32Array;
  index: Uint16Array | Uint32Array;
}

/** Read the exact container `stlToGlb` writes: two accessors, one primitive.
 *  Anything else throws rather than half-parsing. */
export function readGlb(bytes: ArrayBuffer): GlbGeometry {
  if (bytes.byteLength < 20) throw new GlbError("truncated GLB header");
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new GlbError("not a GLB");
  if (view.getUint32(4, true) !== 2)
    throw new GlbError("unsupported GLB version");

  const jsonLen = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON)
    throw new GlbError("first chunk is not JSON");
  const jsonStart = 20;
  const json = JSON.parse(
    new TextDecoder().decode(new Uint8Array(bytes, jsonStart, jsonLen)),
  );

  const binHeader = jsonStart + jsonLen;
  const binLen = view.getUint32(binHeader, true);
  if (view.getUint32(binHeader + 4, true) !== CHUNK_BIN)
    throw new GlbError("second chunk is not BIN");
  const binStart = binHeader + 8;
  if (binStart + binLen > bytes.byteLength)
    throw new GlbError("BIN chunk overruns the file");

  const posAcc = json.accessors?.[0];
  const idxAcc = json.accessors?.[1];
  if (
    posAcc?.componentType !== COMP_FLOAT ||
    posAcc?.type !== "VEC3" ||
    idxAcc?.type !== "SCALAR"
  ) {
    throw new GlbError("unexpected accessor layout");
  }
  const posView = json.bufferViews?.[posAcc.bufferView];
  const idxView = json.bufferViews?.[idxAcc.bufferView];
  if (posView === undefined || idxView === undefined)
    throw new GlbError("missing buffer view");

  // Copy out so the returned arrays own their bytes and stay aligned.
  const positions = new Float32Array(posAcc.count * 3);
  positions.set(
    new Float32Array(
      bytes,
      binStart + (posView.byteOffset ?? 0),
      posAcc.count * 3,
    ),
  );

  const idxOffset = binStart + (idxView.byteOffset ?? 0);
  let index: Uint16Array | Uint32Array;
  if (idxAcc.componentType === COMP_USHORT) {
    index = new Uint16Array(idxAcc.count);
    index.set(new Uint16Array(bytes, idxOffset, idxAcc.count));
  } else if (idxAcc.componentType === COMP_UINT) {
    index = new Uint32Array(idxAcc.count);
    index.set(new Uint32Array(bytes, idxOffset, idxAcc.count));
  } else {
    throw new GlbError("unexpected index component type");
  }
  return { positions, index };
}
