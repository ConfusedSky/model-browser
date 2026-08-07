import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Orbit is per-model (server-persisted) now; clear the retired experiment's
// global settings.
try {
  localStorage.removeItem('model-browser:orbit-mode')
  localStorage.removeItem('model-browser:orbit-flip')
} catch {
  // no localStorage — nothing to clean
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
