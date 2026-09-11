// TEMPORARY — `file-frame-spindle` D7. Deleted by task 5.2 with `bakeToggle.ts`
// (and the `setupFiles` line in vite.config.ts that names this file).
//
// While the compare pill exists, `LocalFramingClient.putThumb`'s first line
// drops every write (`BAKE_PILL_PRESENT`). That is a fact about the test
// window's running app, not about the PUT paths, whose cells assert the
// permanent contract — a PUT reaches the wire, or the local store on a refusing
// deployment. So the guard constant alone is lifted for the whole suite here;
// the flag and its setter stay real. `bakeToggle.test.ts` opens with
// `vi.unmock` and is the file that exercises the guard; `bakePill.test.tsx`
// unmocks it too, so the flip's local renders are seen to write nothing.
import { vi } from 'vitest'

vi.mock('../src/three/bakeToggle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/three/bakeToggle')>()),
  BAKE_PILL_PRESENT: false,
}))
