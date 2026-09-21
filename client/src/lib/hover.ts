export const HOVER_LINGER_MS = 120;

/**
 * Hover-warm debounce: fires only after the pointer lingers, so sweeping the
 * cursor across the grid triggers nothing.
 */
export function createHoverWarmer(
  warm: (path: string, mtime?: number) => void,
  lingerMs: number = HOVER_LINGER_MS,
  setTimer: typeof setTimeout = setTimeout,
  clearTimer: typeof clearTimeout = clearTimeout,
): { enter: (path: string, mtime?: number) => void; leave: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    enter(path: string, mtime?: number): void {
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        // The version travels with the path so the warm and the press it
        // precedes name one URL (D6).
        warm(path, mtime);
      }, lingerMs);
    },
    leave(): void {
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
    },
  };
}
