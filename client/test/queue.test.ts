import { describe, expect, it } from 'vitest'
import { RenderQueue, type Band } from '../src/three/queue'

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('RenderQueue suspension', () => {
  it('does not start queued jobs while suspended, resumes where it left off', async () => {
    const queue = new RenderQueue(1)
    const ran: string[] = []
    queue.suspend()
    queue.push(async () => {
      ran.push('a')
    })
    await tick()
    expect(ran).toEqual([])
    queue.resume()
    await tick()
    expect(ran).toEqual(['a'])
  })

  it('whenResumed gates in-flight jobs across a suspension', async () => {
    const queue = new RenderQueue(1)
    const stages: string[] = []
    queue.push(async () => {
      stages.push('stage1')
      queue.suspend() // interaction begins mid-job
      await queue.whenResumed()
      stages.push('stage2')
    })
    await tick()
    expect(stages).toEqual(['stage1']) // stage2 held back by the gate
    queue.resume()
    await tick()
    expect(stages).toEqual(['stage1', 'stage2'])
  })

  it('whenResumed resolves immediately when not suspended', async () => {
    const queue = new RenderQueue(1)
    await expect(queue.whenResumed()).resolves.toBeUndefined()
  })

  it('cancelled jobs are skipped', async () => {
    const queue = new RenderQueue(1)
    const ran: string[] = []
    queue.suspend()
    const cancel = queue.push(async () => {
      ran.push('a')
    })
    cancel()
    queue.resume()
    await tick()
    expect(ran).toEqual([])
  })
})

/** A job that records its run, pushed while the queue is held so ordering is
 *  decided by rank alone, never by how fast the first dispatch went. */
function recorder(ran: string[], name: string) {
  return async () => {
    ran.push(name)
  }
}

describe('RenderQueue priority', () => {
  it('takes visible before near, near before unreported, unreported before far', async () => {
    const queue = new RenderQueue(1)
    const ran: string[] = []
    queue.suspend()
    queue.push(recorder(ran, 'far'), 'far')
    queue.push(recorder(ran, 'unreported'), 'unreported')
    queue.push(recorder(ran, 'near'), 'near')
    queue.push(recorder(ran, 'visible'), 'visible')
    queue.setRanking(
      new Map([
        ['far', 'far'],
        ['near', 'near'],
        ['visible', 'visible'],
      ]),
    )
    queue.resume()
    await tick()
    expect(ran).toEqual(['visible', 'near', 'unreported', 'far'])
  })

  it('a key absent from the ranking is unreported, never far', async () => {
    // The regression D1 names: a ranking that defaulted missing keys to far
    // would park the world and still pass every ordering cell that only ranks
    // what it mentions. Asserted directly: the unmentioned key beats far.
    const queue = new RenderQueue(1)
    const ran: string[] = []
    queue.suspend()
    queue.push(recorder(ran, 'mentioned-far'), 'a')
    queue.push(recorder(ran, 'absent'), 'b')
    queue.setRanking(new Map([['a', 'far']]))
    queue.resume()
    await tick()
    expect(ran).toEqual(['absent', 'mentioned-far'])
  })

  it('keyless jobs run with visible-ranked ones, in insertion order', async () => {
    // A keyless push is a user press (refreshThumbnail, setOrbitAxis) — it
    // must not wait behind a screenful of unranked sweep misses.
    const queue = new RenderQueue(1)
    const ran: string[] = []
    queue.suspend()
    queue.push(recorder(ran, 'unranked'), 'u')
    queue.push(recorder(ran, 'press'))
    queue.push(recorder(ran, 'visible'), 'v')
    queue.setRanking(new Map([['v', 'visible']]))
    queue.resume()
    await tick()
    expect(ran).toEqual(['press', 'visible', 'unranked'])
  })

  it('an unranked queue behaves exactly as the FIFO it used to be', async () => {
    const queue = new RenderQueue(1)
    const ran: string[] = []
    queue.suspend()
    for (const name of ['a', 'b', 'c', 'd']) queue.push(recorder(ran, name), name)
    queue.resume()
    await tick()
    expect(ran).toEqual(['a', 'b', 'c', 'd'])
  })

  it('ties keep insertion order within a band', async () => {
    const queue = new RenderQueue(1)
    const ran: string[] = []
    queue.suspend()
    for (const name of ['a', 'b', 'c']) queue.push(recorder(ran, name), name)
    queue.setRanking(
      new Map([
        ['a', 'near'],
        ['b', 'near'],
        ['c', 'near'],
      ]),
    )
    queue.resume()
    await tick()
    expect(ran).toEqual(['a', 'b', 'c'])
  })

  it('a re-ranking mid-flight changes what runs next, never what is running', async () => {
    const queue = new RenderQueue(1)
    const ran: string[] = []
    let release = (): void => {}
    const held = new Promise<void>((r) => {
      release = r
    })
    queue.push(async () => {
      ran.push('running')
      await held
      ran.push('running-done')
    })
    queue.push(recorder(ran, 'a'), 'a')
    queue.push(recorder(ran, 'b'), 'b')
    await tick()
    expect(ran).toEqual(['running'])
    // b overtakes a while the first job holds the only slot — and the running
    // job is not interrupted by the ranking arriving under it.
    queue.setRanking(new Map<string, 'visible' | 'far'>([['b', 'visible'], ['a', 'far']]))
    release()
    await tick()
    expect(ran).toEqual(['running', 'running-done', 'b', 'a'])
  })

  it('the cancel handle answers true for a pending job, false for a started one', async () => {
    const queue = new RenderQueue(1)
    let release = (): void => {}
    const held = new Promise<void>((r) => {
      release = r
    })
    const cancelStarted = queue.push(async () => {
      await held
    })
    const cancelPending = queue.push(async () => {})
    await tick()
    // The first job holds the slot (started); the second waits (pending). The
    // answer is what keys `dropStale`: a started job owns its stale-PNG
    // fallback until it finishes on its own (1.2a).
    expect(cancelStarted()).toBe(false)
    expect(cancelPending()).toBe(true)
    // Idempotent: a second ask never claims the cancel again.
    expect(cancelPending()).toBe(false)
    release()
    await tick()
  })

  it('priority respects the suspension gate exactly as FIFO did', async () => {
    const queue = new RenderQueue(1)
    const ran: string[] = []
    queue.suspend()
    queue.push(recorder(ran, 'v'), 'v')
    queue.setRanking(new Map([['v', 'visible']]))
    await tick()
    expect(ran).toEqual([]) // ranked or not, nothing starts while suspended
    queue.resume()
    await tick()
    expect(ran).toEqual(['v'])
  })
})


// ─── bulk-thumbnail-jobs 1.2 ────────────────────────────────────────────────
// A third argument on `push` pins the band, bypassing the ranking. Bulk job
// work must rank no better than deferred far work whatever the grid says about
// the same path — and the grid may well say `visible`, since the job's key is
// an ordinary model path. Every cell below stages a push order that
// *contradicts* the rank it asserts and holds the only slot across the pushes
// (`client/test/CLAUDE.md`'s render-order rule), so it can only pass if rank
// decided.
describe('a pinned band', () => {
  it('outranks nothing: a pinned far job waits for a later-pushed near one, though the ranking calls its key visible', async () => {
    const queue = new RenderQueue(1)
    const ran: string[] = []
    queue.suspend()
    queue.push(recorder(ran, 'job'), 'p', 'far')
    queue.push(recorder(ran, 'near'), 'n')
    queue.setRanking(
      new Map<string, Band>([
        ['p', 'visible'],
        ['n', 'near'],
      ]),
    )
    queue.resume()
    await tick()
    // Pushed first and ranked visible, and still last: the pin is what decided.
    expect(ran).toEqual(['near', 'job'])
  })

  it('ties with a ranked far job, insertion order deciding — in either order', async () => {
    // The spec's "the render queue's lowest existing rank, with which it may
    // tie". The pinned job's key is ranked *visible* in both halves, so a
    // rankOf that consulted the ranking would put it first whichever way round
    // the pushes went, and exactly one half would fail.
    for (const pinnedFirst of [true, false]) {
      const queue = new RenderQueue(1)
      const ran: string[] = []
      queue.suspend()
      if (pinnedFirst) {
        queue.push(recorder(ran, 'pinned'), 'p', 'far')
        queue.push(recorder(ran, 'ranked'), 'r')
      } else {
        queue.push(recorder(ran, 'ranked'), 'r')
        queue.push(recorder(ran, 'pinned'), 'p', 'far')
      }
      queue.setRanking(
        new Map<string, Band>([
          ['p', 'visible'],
          ['r', 'far'],
        ]),
      )
      queue.resume()
      await tick()
      expect(ran).toEqual(pinnedFirst ? ['pinned', 'ranked'] : ['ranked', 'pinned'])
    }
  })

  it('survives a re-ranking that would have promoted its key', async () => {
    // The grid scrolls the job's model into view mid-job. `setRanking` moves
    // every ordinary job it covers; a pinned one it cannot reach at all.
    const queue = new RenderQueue(1)
    const ran: string[] = []
    queue.suspend()
    queue.push(recorder(ran, 'pinned'), 'p', 'far')
    queue.push(recorder(ran, 'other'), 'o')
    queue.setRanking(
      new Map<string, Band>([
        ['p', 'far'],
        ['o', 'far'],
      ]),
    )
    queue.setRanking(
      new Map<string, Band>([
        ['p', 'visible'],
        ['o', 'near'],
      ]),
    )
    queue.resume()
    await tick()
    expect(ran).toEqual(['other', 'pinned'])
  })

  it('is general, not far-only: a pinned visible job runs ahead of unreported work', async () => {
    // The argument pins a band, it does not spell "bulk". `p` is absent from
    // the ranking, so without the pin it would be unreported and lose to the
    // earlier-pushed `u`.
    const queue = new RenderQueue(1)
    const ran: string[] = []
    queue.suspend()
    queue.push(recorder(ran, 'unreported'), 'u')
    queue.push(recorder(ran, 'pinned'), 'p', 'visible')
    queue.resume()
    await tick()
    expect(ran).toEqual(['pinned', 'unreported'])
  })
})
