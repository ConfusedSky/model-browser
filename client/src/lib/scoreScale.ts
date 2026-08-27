/**
 * Which scale a result's cosine is on, and what to call it.
 *
 * The index's two scoring routes produce measurably different distributions —
 * model-to-model cosines run 0.85–0.99 where text-query cosines run ~0.1, over
 * 200 random query models — so a cosine is meaningless without the route that
 * produced it. That is the whole of `semantic-search` D10's objection, and this
 * module is the whole of the answer: the number is shown raw, and the scale is
 * named beside it (confidence-scores-on-tiles D2).
 *
 * The scale is **derived from the view, never stored per result** (D3). A
 * provenance field on each record would be the same string across sixty tiles,
 * derivable from state the client already holds, and able to disagree with the
 * view it is rendered in. Read off the subject, a result can only be labelled as
 * the thing that asked for it.
 *
 * The subject alone does not settle it, which is worth stating because it reads
 * as though it should. `Subject.kind === 'query'` is a *committed phrase*, of
 * either corpus — `mode` is a separate `View` field — so a plain name search is
 * a `query` subject too, and asking the subject by itself would label it `k`.
 * Hence the second argument: `meaning` comes from `labelInputs`, which reads it
 * off whether the answer carried a `scope`, something only the meaning route
 * sends. A similarity view is unaffected — it deliberately carries no `scope`,
 * and `sim` does not consult the flag.
 *
 * The remaining arms yield nothing on their own: `none` covers a plain listing
 * and the stand-in listing shown while a meaning query is deferred. A future
 * third scoring route must extend this to be rendered at all, which is the
 * failure mode we want: unlabelled is unrendered.
 */
import type { Subject } from '../state/view'

export type ScoreScale = 'k' | 'sim'

/**
 * The scale this view's results are on, or `null` where none are scored.
 *
 * `meaning` is `labelInputs`' flag: a committed phrase read against the index
 * rather than against file names. A name search is a committed phrase too and
 * scores nothing, so it must not be labelled as though it did.
 */
export function scaleOf(subject: Subject, meaning: boolean): ScoreScale | null {
  if (subject.kind === 'similar') return 'sim'
  if (subject.kind === 'query' && meaning) return 'k'
  return null
}

/**
 * What a corner badge reads. Short because room in a corner is the constraint,
 * and legible there because sixty tiles carry the same label and the view
 * overhead says which search produced them.
 */
export const SCALE_BADGE: Record<ScoreScale, string> = { k: 'k', sim: 'sim' }

/**
 * What the same scale is called when read aloud (D8). Spelled out because a
 * tile states its accessible name rather than composing it from its contents,
 * so this is a reader's only encounter with the number — and `k` on its own is
 * a letter, one this app already spends on the neighbour *count* (`SIMILAR_K`,
 * and the `k` in a similarity URL). The corner has a reason to be terse; the
 * spoken form has none, and should not imitate one.
 */
export const SCALE_SPOKEN: Record<ScoreScale, string> = { k: 'cosine', sim: 'similarity' }

/** The z's label, which is its whole name on both surfaces and in both forms. */
export const Z_LABEL = 'z'
