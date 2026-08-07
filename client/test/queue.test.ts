import { describe, expect, it } from 'vitest'
import { RenderQueue } from '../src/three/queue'

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
