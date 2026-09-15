/**
 * The About document's entry point — the second of the built client's two
 * (`landing-page` D2).
 *
 * A separate root rather than a view of the app, so the page goes through
 * neither the reducer, the focus trap nor `commitUrl`: it is a document, and
 * the way back to the models is a plain `<a href="/">`. It imports the same
 * `index.css` so Tailwind's layers are the app's, and builds its own
 * `HttpApiClient` for the one dynamic section — the credits list — because all
 * client I/O goes through the API client and never through a raw fetch (D1).
 *
 * Nothing here touches `App`, the viewer or the renderer: the whole point of
 * the second entry is that a page listing names does not ship a WebGL bundle.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HttpApiClient } from './api/client'
import AboutPage from './components/AboutPage'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AboutPage api={new HttpApiClient()} />
  </StrictMode>,
)
