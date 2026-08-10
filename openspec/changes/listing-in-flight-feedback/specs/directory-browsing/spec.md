# directory-browsing Delta

## ADDED Requirements

### Requirement: In-flight listing feedback
While a directory listing request is in flight, the client SHALL acknowledge it visibly: once a listing request has been continuously in flight for a short reveal delay, the grid SHALL be replaced by a skeleton of placeholder tiles until the newest request lands. The delay is measured over continuous in-flight time, not per request — a navigation issued while an earlier request is already pending does not re-arm it. A navigation issued while nothing is in flight that resolves within the delay SHALL never show the skeleton. While the skeleton is shown, the previous listing's tiles SHALL NOT be interactive, but the path bar, parent navigation, and the flat toggle SHALL remain usable. The in-flight indication SHALL follow the newest request only: a superseded request's landing SHALL neither dismiss nor re-trigger it, and a failed request SHALL clear it and surface the error over the listing the user was already viewing.

#### Scenario: Slow navigation shows the skeleton
- **WHEN** the user navigates and the listing request is still unresolved after the reveal delay
- **THEN** the grid is replaced by pulsing placeholder tiles until the response lands, at which point the new listing renders

#### Scenario: Fast navigation never flickers
- **WHEN** the user navigates while no other listing request is in flight and the listing resolves within the reveal delay
- **THEN** the new listing renders directly and no skeleton appears

#### Scenario: Escaping a slow request
- **WHEN** the skeleton is showing and the user submits a different path, navigates up, or toggles flat off
- **THEN** the newer request takes over the in-flight indication, and whichever response is newest when it lands is what renders

#### Scenario: Failure clears the skeleton
- **WHEN** the in-flight request fails
- **THEN** the skeleton is dismissed, the error is surfaced, and the previously shown listing returns
