export const HOVER_LINGER_MS = 120

/**
 * Hover-warm debounce: fires only after the pointer lingers, so sweeping the
 * cursor across the grid triggers nothing.
 */
export function createHoverWarmer(
  warm: (path: string) => void,
  lingerMs: number = HOVER_LINGER_MS,
  setTimer: typeof setTimeout = setTimeout,
  clearTimer: typeof clearTimeout = clearTimeout,
): { enter: (path: string) => void; leave: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    enter(path: string): void {
      if (timer !== null) clearTimer(timer)
      timer = setTimer(() => {
        timer = null
        warm(path)
      }, lingerMs)
    },
    leave(): void {
      if (timer !== null) {
        clearTimer(timer)
        timer = null
      }
    },
  }
}
