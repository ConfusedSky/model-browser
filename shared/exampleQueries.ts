/**
 * The phrases the visitor introduction offers — the banner's chips, the
 * cycling placeholder and the surprise action all read this one list
 * (`landing-page` D9).
 *
 * Meaning queries, not names: the first click should show that the box
 * understands a description. `scripts/check-example-queries.ts <origin>` is a
 * deploy step and fails on a phrase that has gone dead; whether a phrase's
 * first screen is *right* is a reading, not a run.
 *
 * **The two hammer phrases are a pair, not a duplicate**, and they are adjacent
 * so the contrast is on one row of chips: they are there to show a visitor that
 * narrowing a query changes what comes back.
 */
export const EXAMPLE_QUERIES: readonly string[] = [
  "a stone golem",
  "a warrior with a comically large sword",
  "a flaming hammer",
  "a dwarf with a flaming hammer",
  "a weird little guy",
  "a rogue wielding two daggers",
  "a sorcerer with an energy beam",
  "a character with a hammer and shield",
];
