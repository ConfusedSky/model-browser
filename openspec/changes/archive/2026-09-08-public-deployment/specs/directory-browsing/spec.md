# directory-browsing Delta

## MODIFIED Requirements

### Requirement: API restricted to the app's own origin
Because the server reads and serves the user's model library as the user, the server
SHALL reject every `/api/*` request that does not originate from the app itself.
Which origins *are* the app's own SHALL come from the deployment's configuration
(see `public-deployment`) as a set rather than a single value, since one deployment may
answer more than one name, and SHALL default to loopback: requests carrying an `Origin`
header that is not an allowed origin SHALL be refused, requests whose `Host` header is
not an allowed host SHALL be refused, and CORS headers SHALL never be emitted. The
listening address SHALL likewise be configured and SHALL default to loopback. Loopback
SHALL remain allowed whatever else is configured, so that a health check or an operator's
own request from the machine itself is not refused by the deployment it is checking. Binding
alone is NOT sufficient, since on a loopback deployment any page open in the user's
browser can reach a localhost port, and on a public deployment any client anywhere can
reach the address at all. A deployment that answers a public origin SHALL therefore
still confine every path to its library (see `library`) and SHALL refuse the operations
its capabilities declare off (see `feature-report`), because an allowed origin is not a
trusted user. Because no-cors subresource embeds (`<img src>`, `<script src>`) carry no
`Origin` header and so pass the origin check, model bytes SHALL be served as
`Content-Type: application/octet-stream` with `X-Content-Type-Options: nosniff`.

#### Scenario: Another site probes the API
- **WHEN** a page served from an origin the deployment does not allow fetches any `/api/*` endpoint
- **THEN** the request is refused, and no listing, file bytes, or cache write occurs

#### Scenario: DNS rebinding attempt
- **WHEN** a request arrives whose `Host` header is not an allowed host
- **THEN** the request is refused regardless of its `Origin`

#### Scenario: No-cors embed cannot read model bytes
- **WHEN** a cross-origin page embeds `/api/file` as an `<img>` or `<script>` source, sending no `Origin` header
- **THEN** the response declares `application/octet-stream` with `nosniff`, so the browser blocks the load instead of decoding or executing it

#### Scenario: The app's own requests
- **WHEN** the client makes an API request, in dev through the Vite proxy or from the origin the deployment serves it from
- **THEN** the request is allowed

#### Scenario: An unconfigured server is loopback-only
- **WHEN** the server runs with no configured origin
- **THEN** it allows exactly the loopback origins and hosts it allows today, and refuses every other

#### Scenario: A public deployment answers its own origin and no other
- **WHEN** a deployment configures a public origin and a request arrives from a different public origin
- **THEN** the request is refused, and a request from the configured origin is served

#### Scenario: A deployment answering two names
- **WHEN** a deployment configures more than one origin and a request arrives from the second
- **THEN** it is served, as one from the first is

#### Scenario: The machine can always ask itself
- **WHEN** a request arrives from loopback on a deployment that has configured a public origin
- **THEN** it is served, so a health check against the bound port is not refused
