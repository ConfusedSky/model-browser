// @vitest-environment happy-dom
/**
 * The path bar's completion debounce, and what happens to it at unmount.
 *
 * PathBar is mounted directly rather than through `appHarness`: the timer is
 * the whole subject, and the harness's App mount schedules several of its own
 * that a fake clock would have to be advanced past. The two cases are one
 * timer's two endings — fired while the bar is there, cancelled when it is not.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../src/api/client'
import PathBar from '../src/components/PathBar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const completions = vi.fn<(prefix: string) => Promise<string[]>>()
const api = { complete: completions } as unknown as ApiClient

let container: HTMLElement
let root: Root | null = null

async function mountBar(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<PathBar path="/" api={api} onNavigate={() => {}} />)
  })
}

async function unmountBar(): Promise<void> {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container.remove()
}

const pathInput = (): HTMLInputElement => container.querySelector('input')!

/** Native setter + input event — a plain `el.value =` is masked by React's value tracker. */
const type = (el: HTMLInputElement, value: string): Promise<void> =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })

/** Past the 150ms debounce, with the promise it starts allowed to settle. */
const passTheDebounce = (): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })

beforeEach(() => {
  completions.mockReset()
  completions.mockResolvedValue(['/Alpha'])
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the path bar’s debounced completions', () => {
  it('asks for completions 150ms after a keystroke', async () => {
    // The control. Without it the case below passes for the wrong reason —
    // a keystroke that scheduled nothing also calls nothing after unmount.
    await mountBar()
    await type(pathInput(), '/Al')
    expect(completions).not.toHaveBeenCalled()

    await passTheDebounce()
    expect(completions).toHaveBeenCalledExactlyOnceWith('/Al')
    await unmountBar()
  })

  it('cancels the pending request when the bar unmounts inside the window', async () => {
    await mountBar()
    await type(pathInput(), '/Al')
    await unmountBar()

    // What a torn-down client answers: nothing at all. The pending callback
    // reads `.then` off that, which throws where no `.catch` of the
    // component's can see it — the intermittent `TypeError: Cannot read
    // properties of undefined (reading 'then')` this test exists for. With the
    // cleanup in place the timer is gone and the call never happens, so the
    // stub's answer never matters; drop the cleanup and this line is what turns
    // the missed cancellation into the reported crash.
    completions.mockReturnValue(undefined as unknown as Promise<string[]>)
    await passTheDebounce()

    expect(completions).not.toHaveBeenCalled()
  })
})
