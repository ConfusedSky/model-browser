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
 * Chosen 2026-09-15 by running ten candidates against the live demo,
 * https://models.masamaeda.com, under the body a chip's click sends
 * (`{ text, ...TUNING_DEFAULTS }`) and keeping the ones whose first screen is
 * unmistakably right. The index that day answered
 * `/api/semantic/status` with
 * `{"state":"ready","covers":["stl"],"elapsed":5000.1,"collectionRoot":"/"}`.
 * Entry counts from that run, in this order: 60, 60, 60, 60, 58, 60 — the
 * visitor's `top: 60` is the ceiling, so five of the six were cut by the count
 * rather than by the floor. Two candidates were dropped for their *first
 * screen* rather than for a count: "a knight with a sword and shield" (top hit
 * a hobgoblin) and "a pirate" (one unambiguous pirate in five). "a giant
 * spider" answered with 10, which is right but the least headroom against the
 * corpus moving, and was dropped for that.
 *
 * Re-run the whole sweep with `bun run scripts/check-example-queries.ts
 * <origin>`, which is a deploy step: it fails naming any phrase that has gone
 * dead, and the remedy is to replace that phrase here.
 */
export const EXAMPLE_QUERIES: readonly string[] = [
  "a dragon",
  "an elf archer",
  "a skeleton warrior",
  "a wizard casting a spell",
  "a treasure chest",
  "a stone golem",
];
