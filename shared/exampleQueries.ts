/**
 * The phrases the visitor introduction offers — the banner's chips, the search
 * input's cycling placeholder and the surprise action all read this one list
 * (`landing-page` D9), so none of them can drift from the others or from what
 * the deploy-time check proves.
 *
 * They are **meaning** queries, not names: the point of the first click is that
 * the search box understands a description, which a filename search would not
 * answer. Each is a phrase a visitor could plausibly have typed, short enough
 * to read on a chip.
 *
 * Re-run the whole sweep with `bun run scripts/check-example-queries.ts
 * <origin>`, which is a deploy step: it prints every phrase's entry count in
 * this order and fails naming any phrase that has gone dead, whose remedy is to
 * replace it here. It cannot judge a *first screen* — whether the models that
 * come back are unmistakably the thing asked for — so that half of the choice
 * is a reading, not a run.
 *
 * This list is Masa's, 2026-09-16. Measured that day against
 * https://models.masamaeda.com (`/api/semantic/status`:
 * `{"state":"ready","covers":["stl"],"collectionRoot":"/"}`), the counts in
 * this order were 60, 60, 60, 59, 60, 60, 60, 60 — the visitor's `top: 60` is
 * the ceiling, so seven of the eight were cut by the count rather than by the
 * floor, and none came back `weak`.
 *
 * Four carried spelling or article slips when they were written ("flamming",
 * "weilding", "an rogue", "an hammer", and a missing "a"); each was corrected
 * after checking the live index answered the corrected phrase as well as the
 * misspelled one, which it did — same first four hits for three of them, and
 * one count of 60 becoming 59.
 *
 * **The two hammer phrases are a pair, not a duplicate**, and they are adjacent
 * so the contrast is on one row of chips: they are there to show a visitor that
 * narrowing a query changes what comes back. "a flaming hammer" leads with the
 * hammer itself (`Spell_Effects_Pt_1_3332365/SpiritualHammerSpell.stl`); adding
 * "a dwarf with" drops that to fifth and leads with an azer — a fire dwarf —
 * then dwarves. Measured 2026-09-16: they share 4 of the first 5 but only 5 of
 * the first 10, and 26 entries of ~60 overall. Keep both, keep them adjacent,
 * and if either is ever replaced, replace it with another pair that shows the
 * same thing.
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
