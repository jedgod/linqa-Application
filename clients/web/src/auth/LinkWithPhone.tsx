import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { getApiBaseUrl } from "../app/apiSession";
import { deviceLinkClient, DeviceLinkClientError, describeBrowser, type LinkRequest } from "./deviceLinkClient";
import { saveLinkedSession } from "../chat/linkedSession";
import { enrollBrowserWithRustCore } from "./SecureDeviceEnrollment";

const POLL_MS = 2000;

type Phase = "starting" | "waiting" | "linking" | "denied" | "expired" | "error";

/**
 * Link with phone: shows a QR code. On the phone: Settings > Linked devices > Scan QR code, then approve.
 * This computer then registers its own device keys, so no password or code is ever typed here.
 */
export function LinkWithPhone({ onLinked }: { onLinked?: () => void }) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [qr, setQr] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const baseUrl = getApiBaseUrl();

  const start = useCallback(async () => {
    const mine = ++generation.current;
    setPhase("starting");
    setQr(null);
    setMessage(null);
    let link: LinkRequest;
    try {
      link = await deviceLinkClient.create(baseUrl, describeBrowser());
      const image = await QRCode.toDataURL(link.qrText, { margin: 2, width: 280, errorCorrectionLevel: "M" });
      if (!alive.current || mine !== generation.current) return;
      setQr(image);
      setPhase("waiting");
    } catch (error) {
      if (!alive.current || mine !== generation.current) return;
      setPhase("error");
      setMessage(error instanceof DeviceLinkClientError && error.code === "NETWORK" ? "Could not reach Linqa. Check your connection." : "Could not start linking. Try again.");
      return;
    }

    const expiresAt = new Date(link.expiresAt).getTime();
    while (alive.current && mine === generation.current) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (!alive.current || mine !== generation.current) return;
      if (Date.now() > expiresAt) { setPhase("expired"); return; }
      try {
        const status = await deviceLinkClient.status(baseUrl, link);
        if (status === "PENDING") continue;
        if (status === "EXPIRED") { setPhase("expired"); return; }
        if (status === "DENIED") { setPhase("denied"); return; }
        if (status === "APPROVED") {
          setPhase("linking");
          const session = await deviceLinkClient.claim(baseUrl, link);
          const enrolled = await enrollBrowserWithRustCore({ baseUrl, temporarySession: session, deviceName: describeBrowser() });
          // Keep this browser linked across reloads: its device id and a sealed refresh token (see chat/linkedSession.ts).
          await saveLinkedSession({
            userId: enrolled.userId,
            deviceId: enrolled.deviceId,
            installationId: localStorage.getItem("linqa.installation.id") ?? enrolled.deviceId,
            refreshToken: enrolled.session.refreshToken
          });
          if (alive.current) onLinked?.();
          return;
        }
        return;
      } catch (error) {
        // A dropped connection while waiting is not the end: try again on the next beat. Anything else is.
        if (error instanceof DeviceLinkClientError && error.code === "NETWORK") continue;
        if (!alive.current || mine !== generation.current) return;
        setPhase("error");
        setMessage("Linking could not finish. Show a new code and try again.");
        return;
      }
    }
  }, [baseUrl, onLinked]);

  useEffect(() => {
    alive.current = true;
    void start();
    return () => { alive.current = false; generation.current++; };
  }, [start]);

  const retry = phase === "denied" || phase === "expired" || phase === "error";

  return (
    <main style={styles.page}>
      <section style={styles.card} aria-labelledby="link-title">
        <h1 id="link-title" style={styles.title}>Link with your phone</h1>
        <ol style={styles.steps}>
          <li>Open Linqa on your phone</li>
          <li>Go to <strong>Settings</strong> then <strong>Linked devices</strong></li>
          <li>Tap <strong>Scan QR code</strong> and point it here</li>
        </ol>

        <div style={styles.qrBox} aria-live="polite">
          {phase === "waiting" && qr ? <img src={qr} alt="QR code to scan with the Linqa app on your phone" width={280} height={280} /> : null}
          {phase === "starting" ? <p style={styles.status}>Getting a code…</p> : null}
          {phase === "linking" ? <p style={styles.status}>Approved. Setting up secure keys on this computer…</p> : null}
          {phase === "denied" ? <p style={styles.status}>The phone declined this link.</p> : null}
          {phase === "expired" ? <p style={styles.status}>This code expired.</p> : null}
          {phase === "error" ? <p role="alert" style={styles.status}>{message}</p> : null}
        </div>

        {retry ? <button type="button" onClick={() => void start()} style={styles.button}>Show a new code</button> : null}
        <p style={styles.fine}>Your messages stay end-to-end encrypted. This computer gets its own keys; your phone shares nothing but a one-time approval.</p>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F5F6FC", padding: 16 },
  card: { background: "#fff", borderRadius: 24, padding: 32, maxWidth: 440, width: "100%", boxShadow: "0 8px 40px #0F172A14", textAlign: "center", color: "#0F172A", fontFamily: "system-ui, sans-serif" },
  title: { fontSize: 26, margin: "0 0 12px" },
  steps: { textAlign: "left", color: "#475569", lineHeight: 1.7, margin: "0 auto 18px", maxWidth: 320 },
  qrBox: { minHeight: 296, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", borderRadius: 16, border: "1px solid #E2E5F5", margin: "0 auto 14px", width: 296 },
  status: { color: "#475569", padding: 16 },
  button: { background: "#5B4CFF", color: "#fff", border: 0, borderRadius: 12, padding: "12px 20px", fontSize: 16, fontWeight: 600, cursor: "pointer" },
  fine: { color: "#64748B", fontSize: 13, lineHeight: 1.5, marginTop: 16 }
};
