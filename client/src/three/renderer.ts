import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import {
  THUMB_MIME,
  THUMB_SIZE,
  type CameraState,
  type LightingMode,
  type OrbitAxis,
} from "../../../shared/types";
import {
  applyState,
  boundsOf,
  DEFAULT_CAMERA,
  frameFor,
  type Bounds,
} from "./camera";

// The edge is `shared/types.ts`' — the server's preview metadata declares the
// same square — and re-exported here, where every renderer caller reads it.
export { THUMB_SIZE };
/** With `THUMB_SIZE`, what a cold visit's screen of tiles costs. A browser that
 *  cannot encode WebP falls back to PNG silently. */
export const THUMB_QUALITY = 0.8;

/** **Bump whenever rendered output changes for the same input** — rig,
 *  materials, tone mapping, size, encoder — or old renders stay on screen
 *  looking fresh. Entries at another version are re-rendered. */
export const RIG_VERSION = 8;

/** The other recipe input the cache key does not carry. One producible value —
 *  the rig is fixed in camera space — so any other label is stale (D2). */
export const THUMB_LIGHTING = "camera" satisfies LightingMode;

/** **Exactly one `WebGLRenderer` app-wide** (D2/D3), shared by the thumbnail
 *  queue and the orbit overlay. */
let renderer: THREE.WebGLRenderer | null = null;

export function getRenderer(): THREE.WebGLRenderer {
  if (renderer === null) {
    // A hint, not a guarantee: the AO chain is bandwidth-bound and iGPUs feel
    // it first, but the browser's own GPU selection can win.
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  return renderer;
}

// Ambient-occlusion fit (D3), in units of the staged model's bounding-sphere
// radius: GTAO's radius and thickness are world-space, and models run from
// miniatures to busts. Frozen in test/composer.test.ts.
/** Occlusion reach, which doubles as the clip-box feather width — widening it
 *  widens the band where occlusion can reach the silhouette. */
const AO_RADIUS_R = 0.15;
/** Assumed depth behind a surface; wider than the reach, so thin printed walls
 *  do not leak light. */
const AO_THICKNESS_R = 0.3;
const AO_SCALE = 1.5;
const AO_DISTANCE_EXPONENT = 1;
const AO_SAMPLES = 16;

/**
 * A post-process chain on the shared renderer (D1). Renderer-scoped and
 * long-lived — one live, one pinned at `THUMB_SIZE`² — so opening an overlay
 * allocates nothing, and neither chain is ever disposed.
 */
export interface RenderChain {
  readonly composer: EffectComposer;
  /**
   * Re-point every pass and re-fit the occlusion, per render, because the chain
   * is shared: the previous caller left its own scene and fit behind. `ao`
   * disables the GTAO pass, which the composer then skips
   * (`ao-as-recipe-dimension` D4).
   */
  render(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    bounds: Bounds,
    ao?: boolean,
  ): void;
}

/** `setSize` stays off `RenderChain`: only `getLiveChain` may resize. */
type SizedChain = RenderChain & {
  setSize: (width: number, height: number) => void;
};

function makeChain(
  width: number,
  height: number,
  type: THREE.TextureDataType,
): SizedChain {
  // Built by hand: EffectComposer's default target is single-sample and
  // half-float, which drops the MSAA and cannot be read into a Uint8Array.
  const target = new THREE.WebGLRenderTarget(width, height, {
    samples: 4,
    type,
    depthBuffer: true,
  });
  const composer = new EffectComposer(getRenderer(), target);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1);
  const scenePass = new RenderPass(scene, camera);
  const aoPass = new GTAOPass(scene, camera, width, height);
  aoPass.normalMaterial.side = THREE.DoubleSide;
  // OutputPass owns the linear→sRGB conversion for both paths (D2).
  const outputPass = new OutputPass();
  composer.addPass(scenePass);
  composer.addPass(aoPass);
  composer.addPass(outputPass);

  const sized = new THREE.Vector2(width, height);
  return {
    composer,
    setSize(w, h) {
      // ViewerSession sizes the canvas every frame, and resizing a composer
      // target reallocates it.
      if (w === sized.x && h === sized.y) return;
      sized.set(w, h);
      composer.setSize(w, h);
    },
    render(callerScene, callerCamera, bounds, ao = true) {
      aoPass.enabled = ao;
      scenePass.scene = callerScene;
      scenePass.camera = callerCamera;
      aoPass.scene = callerScene;
      aoPass.camera = callerCamera;
      // `distanceFallOff` is deliberately absent: passing it flags the shader
      // for a rebuild, which per frame recompiles forever.
      aoPass.updateGtaoMaterial({
        radius: AO_RADIUS_R * bounds.radius,
        thickness: AO_THICKNESS_R * bounds.radius,
        scale: AO_SCALE,
        distanceExponent: AO_DISTANCE_EXPONENT,
        samples: AO_SAMPLES,
      });
      // Occlusion fades one reach beyond this box, leaving the contact floor
      // and the background alone (D4).
      aoPass.setSceneClipBox(bounds.box);
      composer.render();
    },
  };
}

let liveChain: SizedChain | null = null;
let thumbChain: RenderChain | null = null;

/** Resized only when the host dimensions actually change (D1). */
export function getLiveChain(width: number, height: number): RenderChain {
  if (liveChain === null)
    liveChain = makeChain(width, height, THREE.HalfFloatType);
  else liveChain.setSize(width, height);
  return liveChain;
}

/** Pinned to `UnsignedByteType`: `readRenderTargetPixels` into a `Uint8Array`
 *  needs an 8-bit target (D1). */
export function getThumbChain(): RenderChain {
  if (thumbChain === null) {
    const chain = makeChain(THUMB_SIZE, THUMB_SIZE, THREE.UnsignedByteType);
    chain.composer.renderToScreen = false;
    thumbChain = chain;
  }
  return thumbChain;
}

export interface LitScene {
  scene: THREE.Scene;
  /** The light rig. Orient via quaternion; identity is world-fixed lighting. */
  rig: THREE.Group;
}

// The contract `makeScene` writes and `stageModel` reads. A constant, not a
// literal: a typo in a literal silently drops the key out of the fit.
export const KEY_LIGHT = "key";

export function makeScene(): LitScene {
  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  rig.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.4));
  // The only caster (D2), named so `stageModel` can fit its shadow camera
  // without depending on child order.
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.name = KEY_LIGHT;
  key.position.set(1, 2, 1.5);
  rig.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(-1.5, -0.5, -1);
  rig.add(fill);
  // Blue carries more intensity because the hemisphere ground already tints
  // the scene cool, so equal intensities read red-dominant.
  const rimRed = new THREE.DirectionalLight(0xff4444, 1.4);
  rimRed.position.set(-1.5, 0.3, -0.6);
  rig.add(rimRed);
  const rimBlue = new THREE.DirectionalLight(0x3355ff, 2.5);
  rimBlue.position.set(1.5, 0.3, -0.6);
  rig.add(rimBlue);
  scene.add(rig);
  return { scene, rig };
}

// Shadow fit (D2), in radius units so the rig stays unitless. Frozen in
// test/stageModel.test.ts — changing one changes pixels and needs a
// `RIG_VERSION` bump.
const CASTER_DISTANCE_R = 3;
/** Ortho half-extent: the model sphere plus the floor its shadow sweeps. */
const SHADOW_EXTENT_R = 2;
/** Slack so a grazing light direction never clips the sphere. */
const SHADOW_DEPTH_MARGIN_R = 0.5;
/** Acne scales with world units — a constant bias speckles miniatures. */
const SHADOW_NORMAL_BIAS_R = 0.02;
const SHADOW_MAP_SIZE = 2048;

/** `setLength` keeps the light's direction, and so the shading, exactly as
 *  `makeScene` tuned it; only the shadow camera moves. */
function fitShadow(light: THREE.DirectionalLight, radius: number): void {
  const distance = CASTER_DISTANCE_R * radius;
  const extent = SHADOW_EXTENT_R * radius;
  const margin = SHADOW_DEPTH_MARGIN_R * radius;
  light.position.setLength(distance);
  light.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  light.shadow.normalBias = SHADOW_NORMAL_BIAS_R * radius;
  const cam = light.shadow.camera;
  cam.left = -extent;
  cam.right = extent;
  cam.top = extent;
  cam.bottom = -extent;
  // The light looks at the world origin, where staging put the model.
  cam.near = distance - extent - margin;
  cam.far = distance + extent + margin;
  cam.updateProjectionMatrix();
}

// Contact floor (D3), in radius units. Frozen in test/stageModel.test.ts —
// changing one changes pixels and needs a `RIG_VERSION` bump.
const FLOOR_OPACITY = 0.7;
/** Sunk under the resting face, or a flat print bed z-fights it. */
const FLOOR_SINK_R = 0.002;
/** Wide enough that a camera-mode shadow sweep stays on it. */
const FLOOR_SIZE_R = 8;

/** The unit plane faces +z; this turns that normal onto the spindle. */
const PLANE_NORMAL = new THREE.Vector3(0, 0, 1);

export interface StagedModel {
  /** Centered: the box translated by −rawCenter. */
  bounds: Bounds;
  pivot: THREE.Group;
  /** A scene-level shadow catcher, not part of the model (D3). */
  floor: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
}

/** Lay the floor perpendicular to the spindle at the model's lowest extent
 *  along it (D3). Re-called on an axis change: the floor snaps, never tweens. */
export function placeFloor(
  floor: THREE.Mesh,
  bounds: Bounds,
  axis: OrbitAxis,
): void {
  const s = frameFor(axis).s;
  const { min, max } = bounds.box;
  const support = (c: number, lo: number, hi: number): number =>
    Math.min(c * lo, c * hi);
  const depth =
    support(s.x, min.x, max.x) +
    support(s.y, min.y, max.y) +
    support(s.z, min.z, max.z);
  floor.position.copy(s).multiplyScalar(depth - FLOOR_SINK_R * bounds.radius);
  floor.quaternion.setFromUnitVectors(PLANE_NORMAL, s);
  floor.scale.setScalar(FLOOR_SIZE_R * bounds.radius);
}

/**
 * The one way every view puts a model in a scene (D4): pivot, measure, shift by
 * −center. Camera state is bounds-relative, so the centering moves no pixels.
 *
 * The floor joins the **scene** — a rig-parented one would face the camera, and
 * a model-parented one would be measured (D3).
 */
export function stageModel(
  lit: LitScene,
  object: THREE.Object3D,
  axis: OrbitAxis,
): StagedModel {
  const pivot = new THREE.Group();
  lit.scene.add(pivot);
  pivot.add(object);
  const raw = boundsOf(object);
  pivot.position.copy(raw.center).negate();
  // By name, so the fit never depends on child order (D2).
  const key = lit.rig.getObjectByName(KEY_LIGHT);
  if (key instanceof THREE.DirectionalLight) {
    fitShadow(key, raw.radius);
    key.castShadow = true;
  }
  const bounds: Bounds = {
    center: new THREE.Vector3(),
    radius: raw.radius,
    box: raw.box.translate(pivot.position),
  };
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShadowMaterial({ opacity: FLOOR_OPACITY }),
  );
  floor.receiveShadow = true;
  placeFloor(floor, bounds, axis);
  lit.scene.add(floor);
  return { bounds, pivot, floor };
}

/** three's `add` reparents, so a borrowed object goes home with a plain add. */
export function unstage(
  object: THREE.Object3D,
  pivot: THREE.Group,
  originalParent: THREE.Object3D | null,
): void {
  if (originalParent === null) pivot.remove(object);
  else originalParent.add(object);
}

/**
 * The lossless half of `renderThumbnail`, exported for the frame-ab harness
 * (`file-frame-spindle` D6), which compares renders pixel by pixel. One
 * implementation for both, so both go through `getRenderer()` and the
 * one-renderer rule holds.
 */
export function renderThumbnailCanvas(
  object: THREE.Object3D,
  state: CameraState = DEFAULT_CAMERA,
  axis: OrbitAxis,
  ao = true,
): HTMLCanvasElement {
  const r = getRenderer();
  const lit = makeScene();
  const { scene, rig } = lit;
  // Staging reparents, and the object is LRU-shared with a live session.
  const originalParent = object.parent;
  const { bounds, pivot, floor } = stageModel(lit, object, axis);
  const camera = new THREE.PerspectiveCamera(40, 1);
  applyState(camera, state, bounds, axis);
  // The rig is fixed in the camera's frame, the orientation the live view
  // hands off at (D1); the floor stays in the spindle frame, being geometry.
  rig.quaternion.copy(camera.quaternion);

  const chain = getThumbChain();
  const prevTarget = r.getRenderTarget();
  const pixels = new Uint8Array(THUMB_SIZE * THUMB_SIZE * 4);
  try {
    chain.render(scene, camera, bounds, ao);
    // The composer swaps after `OutputPass`, so the finished frame is in
    // `readBuffer`, already sRGB (D1/D2).
    r.readRenderTargetPixels(
      chain.composer.readBuffer,
      0,
      0,
      THUMB_SIZE,
      THUMB_SIZE,
      pixels,
    );
  } finally {
    // The composer restores this itself, but not if a pass throws.
    r.setRenderTarget(prevTarget);
    unstage(object, pivot, originalParent);
    // **Dispose what this call made**: shadow maps and the floor's
    // geometry/material are VRAM (D5). Every directional light, so the teardown
    // does not depend on which ones cast. The model is LRU-shared — never.
    for (const light of rig.children) {
      if (light instanceof THREE.DirectionalLight) light.dispose();
    }
    floor.geometry.dispose();
    floor.material.dispose();
  }

  // GL readback is bottom-up.
  const canvas = document.createElement("canvas");
  canvas.width = THUMB_SIZE;
  canvas.height = THUMB_SIZE;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("2d context unavailable");
  const image = ctx.createImageData(THUMB_SIZE, THUMB_SIZE);
  const rowBytes = THUMB_SIZE * 4;
  for (let y = 0; y < THUMB_SIZE; y++) {
    const src = (THUMB_SIZE - 1 - y) * rowBytes;
    image.data.set(pixels.subarray(src, src + rowBytes), y * rowBytes);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** `ao` is the caller's reading of the preference, never read here: the pixels
 *  and the cache slot must come from one reading (D4a). */
export function renderThumbnail(
  object: THREE.Object3D,
  state: CameraState = DEFAULT_CAMERA,
  axis: OrbitAxis,
  ao = true,
): Promise<Blob> {
  const canvas = renderThumbnailCanvas(object, state, axis, ao);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) reject(new Error("toBlob failed"));
        else resolve(blob);
      },
      THUMB_MIME,
      THUMB_QUALITY,
    );
  });
}
