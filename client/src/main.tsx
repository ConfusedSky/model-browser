import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { sweepLocalFramings } from "./api/localFramings";
import "./index.css";

// Orbit is per-model (server-persisted) now; clear the retired experiment's
// global settings.
try {
  localStorage.removeItem("model-browser:orbit-mode");
  localStorage.removeItem("model-browser:orbit-flip");
} catch {
  // no localStorage — nothing to clean
}

// And the framings a refusing deployment used to keep here, while that store is
// off (`FRAMINGS_KEPT_LOCALLY`, issue #28): unreachable is not the same as gone,
// and a record left behind would come back the moment the store does.
sweepLocalFramings();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
