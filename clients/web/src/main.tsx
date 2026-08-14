import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppIntegrationShell } from "./app/AppIntegrationShell";
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
