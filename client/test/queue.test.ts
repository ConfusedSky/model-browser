import { describe, expect, it, vi } from 'vitest'
import { FAR_GATE_MAX_MS, RenderQueue } from '../src/three/queue'

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

/**
 * Far dispatch yields to pending lookups for nearer tiles
 * (`thumbnail-image-serving` D5): a gate on another queue holds far-ranked
 * work, for at most `FAR_GATE_MAX_MS`, and never holds nearer work.
 */
describe('RenderQueue far gate', () => {
  /** A job that records its start and stays running until released. */
  function held(ran: string[], name: string): { run: () => Promise<void>; release: () => void } {
    let release!: () => void
    const done = new Promise<void>((r) => (release = r))
    return {
      run: async () => {
        ran.push(name)
        await done
      },
      release,
    }
  }
  const ranking = (bands: Record<string, 'visible' | 'near' | 'far'>) => new Map(Object.entries(bands))

  it('skips far work while the gate is closed, and runs nearer work beside it', async () => {
    const queue = new RenderQueue(2)
    const ran: string[] = []
    let open = false
    queue.setFarGate(() => open)
    queue.setRanking(ranking({ far: 'far', near: 'near' }))
    queue.push(recorder(ran, 'far'), 'far')
    queue.push(recorder(ran, 'near'), 'near')
    await tick()
    expect(ran).toEqual(['near']) // two slots free, one job taken: far waited
    open = true
    queue.poke() // no push, no finish: the gate's opening is enough
    await tick()
    expect(ran).toEqual(['near', 'far'])
  })

  it('pending counts live jobs — running and queued — and never a cancelled husk', async () => {
    const queue = new RenderQueue(1)
    const ran: string[] = []
    const a = held(ran, 'a')
    queue.push(a.run, 'a')
    const cancelB = queue.push(recorder(ran, 'b'), 'b')
    queue.push(recorder(ran, 'c'), 'c')
    await tick()
    expect(queue.pending).toBe(3) // a running, b and c queued
    cancelB()
    expect(queue.pending).toBe(2) // the husk is not live, spliced or not
    a.release()
    await tick()
    expect(queue.pending).toBe(0)
  })

  it('counts only work nearer than far — a queue holding far lookups alone opens the gate', async () => {
    const queue = new RenderQueue(1)
    const ran: string[] = []
    const blocker = held(ran, 'blocker')
    queue.setRanking(ranking({ blocker: 'visible', f1: 'far', f2: 'far', n1: 'near' }))
    queue.push(blocker.run, 'blocker')
    queue.push(recorder(ran, 'f1'), 'f1')
    queue.push(recorder(ran, 'f2'), 'f2')
    await tick()
    expect(queue.pendingNearerThanFar()).toBe(1) // the running visible one
    queue.push(recorder(ran, 'n1'), 'n1')
    expect(queue.pendingNearerThanFar()).toBe(2)
    const unreported = queue.push(recorder(ran, 'u'), 'u')
    expect(queue.pendingNearerThanFar()).toBe(3) // unreported is nearer than far
    unreported()
    expect(queue.pendingNearerThanFar()).toBe(2)
    blocker.release()
    await tick()
    await tick()
    expect(queue.pendingNearerThanFar()).toBe(0) // only f1/f2 could be left, and they are far
  })

  it('settles after the decrement, so a gate read from the settle sees the job gone', async () => {
    const lookups = new RenderQueue(2)
    const renders = new RenderQueue(1)
    const ran: string[] = []
    lookups.setRanking(ranking({ look: 'near', farLook: 'far' }))
    renders.setRanking(ranking({ far: 'far' }))
    renders.setFarGate(() => lookups.pendingNearerThanFar() === 0)
    lookups.onSettle(() => renders.poke())
    const look = held(ran, 'look')
    // A far-ranked lookup pending throughout: nobody's wait, so it must not
    // hold the drain (the delta's *Far lookups do not hold the drain*).
    const farLook = held(ran, 'farLook')
    lookups.push(look.run, 'look')
    lookups.push(farLook.run, 'farLook')
    await tick()
    renders.push(recorder(ran, 'far'), 'far')
    await tick()
    expect(ran).toEqual(['look', 'farLook']) // held: a nearer lookup is pending
    look.release()
    await tick()
    await tick()
    // Resumed on its own — no push, no scroll — with the far lookup still
    // pending.
    expect(ran).toEqual(['look', 'farLook', 'far'])
    farLook.release()
  })

  it('the bound measures a contiguous hold: far work retired and pushed again later is held afresh', async () => {
    // Review R1. The clock started when far work was first held; if it kept
    // running across a gap — the far job retired by a navigation, new far
    // work pushed after the bound — the new job would dispatch at once with
    // a nearer lookup still pending, and the gate would be defeated until
    // some take happened to read it open.
    vi.useFakeTimers()
    try {
      const queue = new RenderQueue(1)
      const ran: string[] = []
      queue.setFarGate(() => false)
      queue.setRanking(ranking({ far1: 'far', far2: 'far' }))
      const cancel = queue.push(recorder(ran, 'far1'), 'far1')
      await vi.advanceTimersByTimeAsync(FAR_GATE_MAX_MS / 2)
      expect(ran).toEqual([])
      cancel() // retired; the next take finds nothing far to hold
      queue.poke()
      await vi.advanceTimersByTimeAsync(FAR_GATE_MAX_MS)
      queue.push(recorder(ran, 'far2'), 'far2')
      await vi.advanceTimersByTimeAsync(FAR_GATE_MAX_MS - 1)
      expect(ran).toEqual([]) // held for its own full bound, not the remainder of a stale one
      await vi.advanceTimersByTimeAsync(2)
      expect(ran).toEqual(['far2'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases far work after the bound when the gate never opens', async () => {
    vi.useFakeTimers()
    try {
      const queue = new RenderQueue(1)
      const ran: string[] = []
      queue.setFarGate(() => false)
      queue.setRanking(ranking({ far: 'far' }))
      queue.push(recorder(ran, 'far'), 'far')
      await vi.advanceTimersByTimeAsync(FAR_GATE_MAX_MS - 1)
      expect(ran).toEqual([])
      await vi.advanceTimersByTimeAsync(2)
      expect(ran).toEqual(['far']) // the gate's own timer re-pumped
    } finally {
      vi.useRealTimers()
    }
  })

  it('clear drops the gate and the settle callback with the jobs', async () => {
    const queue = new RenderQueue(1)
    const ran: string[] = []
    let settled = 0
    queue.setFarGate(() => false)
    queue.onSettle(() => settled++)
    queue.clear()
    queue.setRanking(ranking({ far: 'far' }))
    queue.push(recorder(ran, 'far'), 'far')
    await tick()
    expect(ran).toEqual(['far']) // no gate any more
    expect(settled).toBe(0)
  })
})
