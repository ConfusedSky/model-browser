## Context

`aoToggle.ts` parses the stored value with `raw !== 'off'`: absent means on.
The spec requirement *Ambient-occlusion shading* says "The effect is on by
default." `adaptive-ao-default` (drafted, unapplied) builds a three-state
preference on top of exactly that default.

## Decisions

### D1: Flip the parse, not the storage

`raw === 'on'`: absent and anything malformed read as off; a stored `'on'` or
`'off'` keeps meaning what the user chose. A profile that never pressed the pill
flips from on to off — that is the change, not a side effect. No migration and
no new state: the pill still writes `'on'`/`'off'`.

### D2: Defer, do not retire, the adaptive change

`adaptive-ao-default` D5 says "nothing can be measured with it off; the pill is
the way back" — its whole design assumes unset-means-on. Flipping the default
does not make it wrong, it makes it unimplementable as drafted. The header note
on its tasks file is the record; re-derivation is its own future work.

## Risks / Trade-offs

- [A capable GPU now renders unoccluded until its user finds the pill] → the
  accepted cost of shipping-first; the pill is one press and per profile, and
  the adaptive change remains the drafted answer if it bites.
- [Existing unset profiles silently lose occlusion] → deliberate: default off
  means default off. A user who wants it back presses the pill once.
