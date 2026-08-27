/**
 * The one test that talks to the real index.
 *
 * Everything else in this suite stubs the index, which means none of it can
 * see the property this change depends on: that `rank()` applies the floor to
 * the whole collection *before* the count cuts it (design D2). A stub composes
 * however the stub was written.
 *
 * It cannot be caught by the rows, either. The floor tests the same key the
 * sort ordered by, so the floor set is a prefix of the descending order and
 * `order[mask][:t]` and `order[:t][mask]` select identical rows for every
 * input — fuzzed at 20000 tie-heavy cases with zero divergences. A contract
 * test asserting "none below the floor, at most the count, strongest first"
 * therefore passes against either composition order and reports a safety it
 * does not have.
 *
 * `matched` is the only observable that separates them: counted between the
 * two operations, it is the size of the floor set under floor-then-count and
 * is bounded by the count under the reverse. So the assertion that carries
 * this test is `matched > top`.
 *
 * Skipped unless an index is actually reachable, because a test that silently
 * passes when the thing it tests is absent is worse than no test. Point it at
 * one with MODEL_BROWSER_INDEX_URL; `bun run dev`'s companion server is the
 * usual one (see the repo CLAUDE.md for how to start it).
 */
import { describe, expect, it } from 'vitest'

const INDEX = process.env.MODEL_BROWSER_INDEX_URL ?? 'http://127.0.0.1:8077'
const PHRASE = process.env.MODEL_BROWSER_INDEX_PHRASE ?? 'fantasy character'
const FLOOR = 0.1
const COUNT = 10

async function reachable(): Promise<boolean> {
  try {
    const res = await fetch(`${INDEX}/status`, { signal: AbortSignal.timeout(2000) })
    return res.ok && ((await res.json()) as { ready?: boolean }).ready === true
  } catch {
    return false
  }
}

interface Answer {
  truncated?: boolean
  matched?: number
  results: { score: number }[]
}

const ask = async (body: Record<string, unknown>): Promise<Answer> =>
  (await (
    await fetch(`${INDEX}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: PHRASE, ...body }),
    })
  ).json()) as Answer

describe.skipIf(!(await reachable()))('the index composes the two bounds', () => {
  it('floors the whole collection first, then caps — and says what it cut from', async () => {
    const floorOnly = await ask({ min_score: FLOOR, cap: 10000 })
    const both = await ask({ min_score: FLOOR, top: COUNT, cap: 10000 })

    // The shape. True under either composition order, which is why it is not
    // the assertion this test exists for.
    expect(both.results.length).toBeLessThanOrEqual(COUNT)
    for (const hit of both.results) expect(hit.score).toBeGreaterThanOrEqual(FLOOR)
    const scores = both.results.map((h) => h.score)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)

    // The assertion that separates the orders. Under count-then-floor this is
    // bounded by COUNT; under floor-then-count it is the whole floor set.
    expect(both.matched).toBe(floorOnly.results.length)
    expect(both.matched!).toBeGreaterThan(COUNT)
  })

  it('a floor with no count is not cut to a default the caller never set', async () => {
    // The upstream trap this change's dependency exists for: `top` used to
    // default to ten, and this app omits it whenever it sends a floor.
    const floorOnly = await ask({ min_score: FLOOR, cap: 10000 })
    expect(floorOnly.results.length).toBeGreaterThan(COUNT)
  })

  it('the index’s own ceiling still bites a floor-only set, which is the wall notice’s one state', async () => {
    // With a count in force and clamped at the cap, `truncated` can never fire
    // (design D8), so this is the only state left that can produce the notice.
    const capped = await ask({ min_score: FLOOR })
    expect(capped.truncated).toBe(true)
  })
})
