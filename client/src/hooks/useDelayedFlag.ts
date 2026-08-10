import { useEffect, useState } from 'react'

/** Under the threshold where a click feels ignored, above almost every warm nested listing. */
export const SKELETON_DELAY_MS = 200

/** True only once `flag` has held for `delayMs`; false the instant it drops. */
export function useDelayedFlag(flag: boolean, delayMs: number): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!flag) {
      setHeld(false)
      return
    }
    const timer = setTimeout(() => setHeld(true), delayMs)
    return () => clearTimeout(timer)
  }, [flag, delayMs])
  return held
}
