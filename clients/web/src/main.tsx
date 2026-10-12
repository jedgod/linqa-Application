import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppIntegrationShell } from "./app/AppIntegrationShell";
import { AuthTransitionController } from "./auth/AuthTransitionController";
import { LinkWithPhone } from "./auth/LinkWithPhone";
import { loadLinkedSession } from "./chat/linkedSession";
import { RealChatApp } from "./chat/RealChatApp";
import "./styles/app.css";
import "./styles/responsive-hardening.css";
import "./runtime/runtime.css";

type Mode = "checking" | "link" | "chats" | "demo";

function Root() {
  // Demo data stays available for development at ?demo=1; everyone else uses a linked computer.
  const demo = new URLSearchParams(window.location.search).get("demo") === "1";
  const [mode, setMode] = useState<Mode>(demo ? "demo" : "checking");

  useEffect(() => {
    if (demo) { new AuthTransitionController().setDemoIdentity(); return; }
    let live = true;
    void loadLinkedSession().then((saved) => { if (live) setMode(saved ? "chats" : "link"); });
    return () => { live = false; };
  }, [demo]);

  const linked = useCallback(() => setMode("chats"), []);
  const signedOut = useCallback(() => setMode("link"), []);

  if (mode === "checking") return null;
  if (mode === "link") return <LinkWithPhone onLinked={linked} />;
  if (mode === "chats") return <RealChatApp onSignedOut={signedOut} />;
  return (
    <AppIntegrationShell>
      <App />
    </AppIntegrationShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
