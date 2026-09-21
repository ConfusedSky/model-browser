## Context

See proposal.md — Why. What shapes the approach is where the loopback rule is spelt and who
reads it. `server/src/guard.ts` holds it twice — `LOOPBACK_ORIGIN` over `scheme://host[:port]`
and `LOOPBACK_HOST` over a bare `Host` — and exports `isLoopbackOrigin` with a comment saying
the export exists so the guard's rule and the preview resolver's "not a public origin" test
cannot drift apart. Three call sites read the pair: `guard`'s `Origin` check, `isAllowedHost`'s
first line, and `createDescribe` in `server/src/preview.ts`, which uses `isLoopbackOrigin` to
skip loopback entries when picking the deployment's declared identity and `isAllowedHost` to
decide whether a request's host may be told about the library at all. A fourth name looks
related and is not: `LOOPBACK_HOSTS` in `server/src/config.ts` validates `listen.host` (D4).

`isAllowedHost` runs `LOOPBACK_HOST.test(host)` on the raw header and lowercases only for the
allowlist compare — the case question D3 answers.

## Goals / Non-Goals

**Goals:**

- One rule, in one place, for what loopback means, still read by all three call sites.
- The widened set is pinned by tests at its edges, not by reading a regex.
- Nothing new to configure: a `.localhost` dev name works with the tracked configuration
  untouched.

**Non-Goals:**

- Any change to what `listen.host` accepts (D4).
- Any general wildcard or suffix matching for configured `origins`. An entry there stays an
  exact origin; this change widens only the always-allowed loopback set.
- Making `scripts/dev-remote.sh` unnecessary. A tailnet name is routable and machine-specific
  and still needs an `origins` entry.

## Decisions

### D1: One widened sub-pattern, in both regexes

`(([a-z0-9-]+\.)*localhost|127\.0\.0\.1|\[::1\])` replaces the alternation in both
`LOOPBACK_ORIGIN` and `LOOPBACK_HOST`; the anchors and the `(:\d+)?` tail are unchanged, as are
the two literal addresses. `([a-z0-9-]+\.)*` is a superset of the LDH labels RFC 1123 allows —
it admits a label that begins or ends with a hyphen, which RFC 1123 does not — repeated, so
`build-a.localhost` and `a.b.localhost` match and the bare `localhost` still does (zero
repetitions). The superset is deliberate: the anchors, not the label class, are what bound the
rule, and the extra spellings are names nothing resolves (Risks).

The anchors are what make this safe to read: `$` after the `(:\d+)?` tail means the name must
end at `localhost`, so `localhost.evil.com` fails (the alternation consumes `localhost` and then
`$` cannot meet `.evil.com`), and `^` together with the required `.` in each repeated label
means `notlocalhost` fails too — there is no way to reach `localhost` without a dot or the start
of the string immediately before it.

Alternative considered: parse with `new URL()` and test `hostname === "localhost" ||
hostname.endsWith(".localhost")`. It reads better, but `LOOPBACK_HOST` is handed a bare `Host`
that is not a URL, so it would need a synthetic scheme prepended and a try/catch for a malformed
header — more code, and a second place where a parse failure has to be decided. A regex is what
is there and what the issue proposes.

Not admitted, deliberately: a trailing dot (`build-a.localhost.`, the fully-qualified spelling).
Browsers do not send it for a `.localhost` name, and admitting it would mean admitting one more
spelling of every name in the pattern for no case anyone has.

### D2: `.localhost` is loopback for previews too

`createDescribe` picks `configured = origins.find((origin) => !isLoopbackOrigin(origin))` as the
origin to state in `og:url` and to build the image address from. Widening `isLoopbackOrigin`
means a configured `http://x.localhost:5173` entry is now skipped there, and a deployment whose
*only* entry is such a name describes itself by the requesting host instead, exactly as an
unconfigured server does.

That is the wanted answer, not a cost to be paid: `og:url` is an address a consumer of the
metadata will re-fetch from somewhere else, and a `.localhost` name resolves to the *consumer's*
own machine. Stating one would be worse than stating the request's host. The same widening
applies to the preview's `isAllowedHost` gate, which is the point of the shared export — a
`.localhost` request now gets the library half of the preview, matching what `/api/dir` will
answer it.

The existing preview cell *skips a loopback entry to find the origin a visitor can reach* still
passes: its loopback entry is `http://127.0.0.1:3177`, untouched here.

### D3: Case-insensitive, by the `i` flag on both patterns

`Build-A.localhost` must be allowed — DNS names are case-insensitive, and the guard already
treats case as no difference for configured names (`isAllowedHost` lowercases before the set
lookup, and a guard cell asserts `Models.MasaMaeda.com` is served), so loopback should not be the
one name where spelling matters. A browser is not where mixed case comes from: the WHATWG URL
host parser lowercases ASCII hostnames, so the `Host` and `Origin` a browser sends are already
lowercase whatever the user typed. A proxy that rewrites the header, or a hand-written request,
is. The `i` flag on both regexes is one character per pattern and
covers `LOOPBACK_HOST`'s raw-header input and `isLoopbackOrigin`'s origin-string input at once.

Alternative: lowercase at the call sites (`LOOPBACK_HOST.test(host.toLowerCase())`). That is two
edits instead of one and leaves the next caller of the exported `isLoopbackOrigin` to remember
the same thing.

Consequence worth naming: the flag also makes a mixed-case *bare* loopback entry — an origins
entry spelt `HTTP://LocalHost:3177` — count as loopback, which today it does not. That is the
rule the rest of the guard already applies, so it is a gap closed rather than behaviour added.

### D4: `listen.host` is out of scope

`LOOPBACK_HOSTS` in `server/src/config.ts` gates a different thing: it is the check that refuses
a configuration binding past loopback with no `origins`, and `listen.host` is handed to the
runtime as a bind address. A bind address is resolved by the operating system, not by a browser,
and the `.localhost` special case that makes this change correct is a *browser* behaviour — a
system resolver is under no obligation to answer for `build-a.localhost`. Widening that list
would accept a configuration that either fails at bind or binds somewhere the operator did not
mean. It stays a three-element list of literal addresses.

### D5: No `origins` entry, no Vite change

Vite's `server.allowedHosts` documents its default as: "`localhost` and domains under
`.localhost` and all IP addresses are allowed by default" (Vite docs, Server Options —
`server.allowedHosts`), so the dev server already answers `build-a.localhost:5173` with
`VITE_ALLOWED_HOSTS` unset. Its `/api` proxy forwards the browser's `Host` rather than rewriting
it — the reason `scripts/dev-remote.sh` has to add a tailnet name to `origins` — so after this
change the guard sees `build-a.localhost:5173` and allows it, and nothing else in the dev path
needs to know. `client/vite.config.ts` is not edited.

## Risks / Trade-offs

- [A malicious page on `evil.localhost` can reach the API] → It always could, under
  `localhost` itself: any page the user's browser loads from loopback is inside the guard's
  always-allowed set by design (`public-deployment` D3/D8), and confinement and the feature
  refusals are what stand between an allowed origin and the library. Reaching `evil.localhost`
  requires already serving from this machine.
- [DNS rebinding] → Unchanged. A rebinding attack needs a name the attacker controls in public
  DNS; `.localhost` is reserved, and a resolver that returns a public address for it is broken
  in a way no application check can repair. The `Host` test still refuses every name that does
  not end at `localhost` or name a loopback address.
- [The regex admits a name a browser would not resolve] → Possible: the label class is a superset
  of LDH, so `-.localhost` matches here and is not a hostname RFC 1123 allows. Harmless: the name
  has to resolve to this machine before any request carrying it exists, and every such spelling
  still ends at `localhost`, so nothing outside the reserved TLD is reached.
- [A deployment that configures a `.localhost` origin silently loses its declared identity in
  previews] → D2, and it is the answer that change wants. No shipped configuration does this:
  `deploy/demo/config.json` names a public origin.

## Migration Plan

None. No configuration key changes, no stored data, and every host allowed before is allowed
after. Rollback is reverting the two patterns.
