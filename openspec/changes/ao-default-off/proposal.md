## Why

Ambient occlusion defaults to on, so every fresh profile — every demo visitor —
pays the GTAO cost until they find the pill (17 → 56 fps on an orbit drag on the
Radeon 780M, `viewer-ssao`). The adaptive default (`adaptive-ao-default`) was the
planned answer, but shipping the demo outranks it (Masa, 2026-08-31): flip the
static default to off now, adapt later if at all. What made this cheap is
`ao-as-recipe-dimension`: thumbnails follow the preference, so a default of off
no longer pays the handoff jump that got this exact option rejected in the
original exploration (`docs/web-demo-notes.md` item 8, option (a)).

## What Changes

- Occlusion is **off by default**. A profile that stored a choice keeps it —
  `'on'` stays on — but an unset profile now reads off.
- `adaptive-ao-default` is **deferred, not retired**: its premise ("unset behaves
  as on until measured"; nothing can be measured with occlusion off) is inverted
  by this change, so it must be re-derived before it can be applied. Its tasks
  header records that.

## Capabilities

### Modified Capabilities

- `model-viewer`: **MODIFY** *Ambient-occlusion shading* — "on by default"
  becomes "off by default"; everything else stands, scenarios carried.

## Impact

`client/src/viewer/aoToggle.ts` (the parse), its tests, and any test that relied
on the implicit default rather than setting the preference. No server change,
no wire change, no `RIG_VERSION` bump — both recipes' pixels are untouched.
