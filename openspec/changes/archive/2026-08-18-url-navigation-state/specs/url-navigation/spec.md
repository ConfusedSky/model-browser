# url-navigation Delta

## ADDED Requirements

### Requirement: The URL names the committed view
The client SHALL reflect the committed view in the page URL as query parameters on its single route: the current directory or zip path, whether the flat view is active, the committed deep-search query, and the open lightbox's model path. The URL SHALL describe only views that actually rendered — in-flight navigation targets, failed requests, and superseded responses SHALL NOT reach it. Ephemeral and preference state (the live filter text, the orbit overlay, lighting mode, the ambient-occlusion preference) SHALL stay out of the URL.

#### Scenario: The URL tracks navigation
- **WHEN** the user navigates to a directory, toggles flat, or commits a search, and the listing renders
- **THEN** the URL updates to name that exact view, and copying it reproduces the view in another tab

#### Scenario: Optimistic and failed navigation leave no trace
- **WHEN** a navigation is still in flight, or fails, or is superseded by a newer request
- **THEN** the URL continues to name the view actually on screen

### Requirement: Browser history navigates committed views
Each committed view change — a landed navigation, a flat-view toggle, a committed or cleared search, an opened lightbox — SHALL create one browser history entry, and back/forward SHALL restore the corresponding views, replaying them through the same request path as user navigation (latest-wins supersession and loading feedback included). Restoring a search view SHALL restore its committed query and results presentation, not a plain listing. History restoration SHALL NOT itself create new entries. Re-committing the view the URL already names SHALL NOT stack a duplicate entry.

#### Scenario: Back and forward walk the view history
- **WHEN** the user navigates through several directories, toggles flat, and commits a search, then presses back repeatedly
- **THEN** each press restores the previous view in order — the search results (with their query and label), the flat listing, each directory — and forward walks the same views the other way

#### Scenario: History replay is a real navigation
- **WHEN** a back/forward restoration's listing request is slow or fails
- **THEN** the skeleton and error behavior match ordinary navigation, and no additional history entries appear

### Requirement: Deep links restore the view
Loading a URL that carries navigation parameters SHALL restore that view: the named directory (nested, flat, or as search results per the parameters), and the named lightbox model once it is present in the loaded listing. A model parameter naming an entry absent from its listing SHALL be dropped silently from the URL rather than surfacing an error. A URL without navigation parameters SHALL keep the existing last-path boot behavior, and the resolved view SHALL then be recorded into the URL without creating a history entry.

#### Scenario: A shared search link
- **WHEN** a URL naming a directory, flat mode, and a committed query is opened fresh
- **THEN** the app boots directly into those search results, label and all, without passing through the last-path view

#### Scenario: A stale model link degrades gracefully
- **WHEN** a URL names a lightbox model that no longer exists in the directory it points into
- **THEN** the directory view renders normally and the dangling model parameter disappears from the URL

### Requirement: The lightbox participates in history as a modal
Entering the lightbox SHALL push a history entry naming the model, by whichever route the user entered it — including promotion from the transient orbit overlay, which is how a pointer opens it — so that no lightbox is ever displayed without a corresponding entry and parameter. The browser back action SHALL close it, and every in-app close affordance SHALL route through history so all paths are one; forward SHALL re-open it. Closing SHALL run the same teardown regardless of what initiated it, including camera/thumbnail persistence, and SHALL complete that teardown rather than being pre-empted by the history transition. A lightbox restored from the URL at load — whose entry the app did not push, and behind which there is no in-app view to return to — SHALL instead close by removing the model parameter without a history entry, and SHALL NOT navigate the user out of the app. The transient orbit overlay SHALL NOT create history entries.

#### Scenario: Back closes the lightbox
- **WHEN** the user opens a model's lightbox and presses the browser back button
- **THEN** the lightbox closes onto the unchanged listing — with its camera persisted exactly as a ✕ close would — and forward re-opens the same model

#### Scenario: A pointer-opened lightbox is a history entry too
- **WHEN** the user opens a lightbox with the pointer, by tapping a tile so the orbit overlay promotes rather than by the keyboard
- **THEN** it carries a history entry and a model parameter like any other, and closing it returns to the listing rather than navigating the listing backwards

#### Scenario: Every close affordance behaves the same
- **WHEN** the user closes the lightbox by the ✕ button, by Escape, or by clicking the backdrop
- **THEN** each performs the same teardown and leaves the same history position, and the model parameter is gone from the URL in every case

#### Scenario: Closing a deep-linked lightbox stays in the app
- **WHEN** the user opens a URL naming a lightbox model directly and then closes it
- **THEN** the lightbox closes onto its listing and the app remains in view — the close does not leave the app for whatever preceded it in the browser's history
