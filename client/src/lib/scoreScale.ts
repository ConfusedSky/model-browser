/**
 * The index's two routes produce distributions an order of magnitude apart, so a
 * cosine is meaningless without the route that produced it (`semantic-search`
 * D10): the number is shown raw and the scale named beside it (D2). **Derived
 * from the view, never stored per result** (D3), and a future third route must
 * extend this to render at all — unlabelled is unrendered.
 */
import type { Subject } from "../state/view";

export type ScoreScale = "k" | "sim";

/** `meaning` is `labelInputs`' flag: a phrase read against the index rather
 *  than against file names, which a name search is not. */
export function scaleOf(subject: Subject, meaning: boolean): ScoreScale | null {
  if (subject.kind === "similar") return "sim";
  if (subject.kind === "query" && meaning) return "k";
  return null;
}

/** Short because room in a corner is the constraint. */
export const SCALE_BADGE: Record<ScoreScale, string> = { k: "k", sim: "sim" };

/** Spelled out (D8): a tile states its accessible name rather than composing
 *  it, and `k` alone is a letter already spent on the neighbour count. */
export const SCALE_SPOKEN: Record<ScoreScale, string> = {
  k: "cosine",
  sim: "similarity",
};

export const Z_LABEL = "z";
