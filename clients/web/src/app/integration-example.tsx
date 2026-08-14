/*
Example integration into the existing web entry point (adapted for this
repo's actual entry point, src/main.tsx + src/App.tsx):

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppIntegrationShell } from "./app/AppIntegrationShell";
import { App } from "./App";
import "./styles/app.css";
import "./styles/responsive-hardening.css";
import "./runtime/runtime.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppIntegrationShell>
      <App />
    </AppIntegrationShell>
  </StrictMode>
);

The existing mock application remains unchanged inside App.
Add CapabilityGate only around new stage-specific controls.
Not applied to src/main.tsx directly in this pass — see clients/web/README.md
for why the runtime layer is copied in but not yet wired around the live UI.
*/
export {};
