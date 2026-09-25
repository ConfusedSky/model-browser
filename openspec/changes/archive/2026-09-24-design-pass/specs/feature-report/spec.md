## MODIFIED Requirements

### Requirement: An offer whose only product is pixels the deployment would not store is withheld
Where everything an offered action produces is a render the deployment would not store, the
client SHALL withhold that offer rather than present it and let the user spend the work. This
SHALL hold whatever the scale of the action: a launcher that loops over a scope and a command
that acts on one entry are withheld by the same reason, since the reason is what the work
produces and not how much of it there is. Such an action cannot report itself honestly either:
it fetches the bytes it operates on, renders them, and the surface it acts on shows the result
until the view is next rebuilt from the deployment, so a user cannot tell it from one that was
kept.

An offer that also writes an **orientation** — one it establishes, or one it gives up — is
outside this requirement, whether that orientation reaches the deployment or is held by the
browser instead. Such an action is not reducible to its pixels: it changes where the model is
shown from, which is the whole of what it claims, and what becomes of an orientation a
deployment declines is `model-thumbnails`' question rather than this one. This requirement
SHALL NOT withhold such an offer; whether one is offered is decided by the action's own
requirement, and `entry-actions` withholds giving a framing up where the deployment does not accept
thumbnail writes (*Refreshing a model's thumbnail and its framing*), while choosing an orbit
axis stands wherever the model's menu does.

An offer SHALL be withheld likewise where the deployment has not yet said what it accepts, so
that nothing is rendered which then vanishes when the answer arrives. Withholding at the
client SHALL NOT replace refusal at the route: the route refuses whatever client asks, and
this requirement governs only what is offered.

#### Scenario: A single-entry render whose pixels would be dropped
- **WHEN** a viewer raises the actions for one entry on a deployment that would not store the render that action produces, and that action produces nothing else
- **THEN** the action is absent rather than present and inert, and no bytes are fetched for it

#### Scenario: Scale is not the reason
- **WHEN** two offers produce the same unstored render and nothing else, one over a scope and one over a single entry
- **THEN** both are absent, by the same stated reason

#### Scenario: An offer that writes an orientation stands
- **WHEN** an offer establishes an orientation for a model — choosing its orbit axis from the tile's menu — on a deployment that would not store the render it draws alongside
- **THEN** the offer stands and the action takes effect, since what it claims is where the model is shown from rather than the image; giving a stored orientation up is not withheld by this requirement either, and is absent there only by `entry-actions`' own rule

#### Scenario: Withheld until the deployment has answered
- **WHEN** a viewer raises such an action before the deployment's report has been read, or after the read failed
- **THEN** the action is absent, and it appears only once a report is known to accept the write

#### Scenario: The route still refuses
- **WHEN** the refused write arrives at its route anyway
- **THEN** the route refuses it, since withholding the offer is not what makes the declaration true
