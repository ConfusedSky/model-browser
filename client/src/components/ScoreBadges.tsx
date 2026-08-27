import type { IndexScore } from '../../../shared/types'
import { formatCosine, formatZ } from '../lib/format'
import { SCALE_BADGE, Z_LABEL, type ScoreScale } from '../lib/scoreScale'

/**
 * A corner badge. Anchored to the top of whatever box holds it and sized to
 * stay out of the way — the grid's smallest tile is 11rem, so two of these
 * leave the middle clear. The backing is opaque enough to read over a pale
 * model and dark enough to read over a bright one; `tabular-nums` keeps a
 * column of them from jittering as digits change. `pointer-events-none` so a
 * badge is never the target of the press that orbits or opens the tile — which
 * matters most on the orbit overlay, where every pointer event is the gesture.
 */
const BADGE_CLASS =
  'pointer-events-none absolute top-0 rounded bg-zinc-950/80 px-1 py-px text-[0.625rem] font-medium tabular-nums leading-tight text-zinc-300 ring-1 ring-zinc-800/60'

/**
 * The index's two numbers, in the corners of the box they are given: the cosine
 * top-left under the scale's own short label, the z top-right.
 *
 * One definition, two surfaces — the grid tile and the orbit overlay that
 * covers it. They are not one element moved between them: the overlay is a
 * `fixed` layer of its own, drawn over the tile rather than inside it, so the
 * only way the numbers survive a press is to be drawn again there. Sharing the
 * component rather than the markup is what stops the two from drifting, the way
 * the info panel and the context menu share `MENU_ITEM_CLASS`.
 *
 * `aria-hidden` on both, for a different reason on each surface. The tile
 * states the numbers in its own accessible name (D8) — it names itself rather
 * than composing a name from its contents — so announcing them here too would
 * say each one twice. The orbit overlay has no accessible name at all: it is an
 * unnamed transient layer drawn over the tile that spawned it, and the thing it
 * is about has already been announced. Neither surface is left silent by this;
 * both are covered by the tile's own label.
 *
 * Renders nothing without both a score and a scale. An unlabelled cosine is not
 * a lesser version of a labelled one — the two scoring routes run on
 * measurably different distributions, so a bare number invites a comparison it
 * cannot support (D2). Unlabelled is unrendered.
 */
export default function ScoreBadges({
  score,
  scale,
}: {
  score: IndexScore | undefined
  scale: ScoreScale | null
}): React.ReactElement | null {
  if (score === undefined || scale === null) return null
  return (
    <>
      <span aria-hidden className={`${BADGE_CLASS} left-0`}>
        {SCALE_BADGE[scale]} {formatCosine(score.score)}
      </span>
      <span aria-hidden className={`${BADGE_CLASS} right-0`}>
        {Z_LABEL} {formatZ(score.z)}
      </span>
    </>
  )
}
