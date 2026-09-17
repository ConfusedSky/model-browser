import type * as THREE from "three";
import type { ApiClient } from "../api/client";
import type { LoadedModel } from "./lru";
import {
  embedded3mfThumbnail,
  formatOf,
  geometryBytes,
  parseModel,
} from "./models";

/** The `MeshLru` loader. `placeholderRef` is read at call time, so the loader
 *  can be built before `useThumbnails` hands over `setPlaceholder`. */
export function meshLoader(
  api: Pick<ApiClient, "fetchModel" | "fetchModelGlb">,
  placeholderRef: { current: (path: string, url: string) => void },
): (path: string) => Promise<LoadedModel<THREE.Object3D>> {
  return async (path) => {
    const format = formatOf(path);
    if (format === null) throw new Error(`not a model: ${path}`);
    // STL geometry arrives as a derived GLB (server-glb-cache); `obj`/`3mf`
    // keep their own bytes.
    if (format === "stl") {
      const bytes = await api.fetchModelGlb(path);
      const object = parseModel(bytes, "glb");
      return { object, bytes: geometryBytes(object) };
    }
    const bytes = await api.fetchModel(path);
    if (format === "3mf") {
      const preview = embedded3mfThumbnail(bytes);
      if (preview !== null) placeholderRef.current(path, preview);
    }
    const object = parseModel(bytes, format);
    return { object, bytes: geometryBytes(object) };
  };
}
