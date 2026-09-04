// @vitest-environment happy-dom
//
// The chip's one time-dependent word (`bulk-thumbnail-jobs` 5.2): a generate
// entry pinned to the far band waits behind whatever the user is looking at,
// and a chip that says "0 of 96" for twelve seconds with no reason reads as
// hung. The word appears only after a wait outlasts `WAITING_AFTER_MS` and
// goes the moment the entry starts.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JobChip, { WAITING_AFTER_MS } from '../src/components/JobChip'
import type { JobState } from '../src/jobs/bulkJobs'

const running = (waiting: boolean): JobState => ({
  runId: 1,
  operation: 'generate',
  scope: { path: '/kit', label: 'kit' },
  phase: 'running',
  total: 96,
  done: 0,
  failed: 0,
  skipped: 0,
  wrote: 0,
  settled: false,
  waiting,
  incomplete: false,
  dismissed: false,
})

let container: HTMLDivElement
let root: Root
const text = (): string => container.querySelector('p')?.textContent ?? ''
function show(state: JobState): void {
  act(() => {
    root.render(<JobChip state={state} onConfirm={() => {}} onCancel={() => {}} onDismiss={() => {}} />)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('the chip under a held entry', () => {
  it('says it is waiting only after the wait has lasted, and stops saying so when the entry starts', () => {
    show(running(true))
    expect(text()).toBe('Generating thumbnails beneath kit: 0 of 96')
    act(() => {
      vi.advanceTimersByTime(WAITING_AFTER_MS - 1)
    })
    expect(text()).toBe('Generating thumbnails beneath kit: 0 of 96')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(text()).toBe('Generating thumbnails beneath kit: 0 of 96 · waiting behind what you’re looking at')
    show(running(false))
    expect(text()).toBe('Generating thumbnails beneath kit: 0 of 96')
  })

  it('does not accumulate short waits into a long one', () => {
    show(running(true))
    act(() => {
      vi.advanceTimersByTime(WAITING_AFTER_MS - 100)
    })
    show(running(false))
    show(running(true))
    act(() => {
      vi.advanceTimersByTime(WAITING_AFTER_MS - 100)
    })
    expect(text()).toBe('Generating thumbnails beneath kit: 0 of 96')
  })
})
