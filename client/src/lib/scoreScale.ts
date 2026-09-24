/**
 * The index's two routes produce distributions an order of magnitude apart, so a
 * cosine is meaningless without the route that produced it (`semantic-search`
 * D10): the number is shown raw and the scale named beside it (D2). **Derived
 * from the view, never stored per result** (D3), and a future third route must
 * extend this to render at all — unlabelled is unrendered.
 */
import type { Subject } from "../state/view";
import { stored } from "./stored";

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

/**
 * A result's standing in one word, from how far its z stands above the rest of
 * the collection — what a reader can act on without knowing what a cosine is.
 * The raw pair stays available behind the "Show match scores" option.
 */
export function strengthOf(z: number): "Strong" | "Good" | "Fair" | "Weak" {
  if (z >= 4) return "Strong";
  if (z >= 3) return "Good";
  if (z >= 2) return "Fair";
  return "Weak";
}

/** Off unless a profile turns it on: the numbers need a legend a visitor
 *  does not have. */
export const showScoresStore = stored<boolean>(
  "model-browser:show-scores",
  (raw) => raw === "1",
  (v) => (v ? "1" : "0"),
);
