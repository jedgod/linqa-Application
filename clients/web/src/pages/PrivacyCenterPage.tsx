import { useEffect, useState } from "react";
import { PrivacySettingsClient, type PrivacySettings } from "../privacy/PrivacySettingsClient";

const VISIBILITY_OPTIONS: PrivacySettings["profileVisibility"][] = ["EVERYONE", "CONTACTS", "NOBODY"];

const DEFAULT_SETTINGS: PrivacySettings = {
  profileVisibility: "CONTACTS",
  phoneDiscoverability: true,
  emailDiscoverability: false,
  usernameDiscoverability: true,
  readReceipts: true,
  typingIndicators: true,
  lastSeenVisibility: "CONTACTS"
};

function fromRow(row: any): PrivacySettings {
  if (!row) return DEFAULT_SETTINGS;
  return {
    profileVisibility: row.profile_visibility ?? DEFAULT_SETTINGS.profileVisibility,
    phoneDiscoverability: row.phone_discoverability ?? DEFAULT_SETTINGS.phoneDiscoverability,
    emailDiscoverability: row.email_discoverability ?? DEFAULT_SETTINGS.emailDiscoverability,
    usernameDiscoverability: row.username_discoverability ?? DEFAULT_SETTINGS.usernameDiscoverability,
    readReceipts: row.read_receipts ?? DEFAULT_SETTINGS.readReceipts,
    typingIndicators: row.typing_indicators ?? DEFAULT_SETTINGS.typingIndicators,
    lastSeenVisibility: row.last_seen_visibility ?? DEFAULT_SETTINGS.lastSeenVisibility
  };
}

export function PrivacyCenterPage({ apiBaseUrl, accessToken }: { apiBaseUrl: string; accessToken: string }) {
  const [client] = useState(() => new PrivacySettingsClient(apiBaseUrl, () => Promise.resolve(accessToken)));
  const [data, setData] = useState<any | null>(null);
  const [settings, setSettings] = useState<PrivacySettings>(DEFAULT_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    setError(null);
    fetch(`${apiBaseUrl}/v1/privacy-center`, { headers: { authorization: `Bearer ${accessToken}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((v) => {
        setData(v);
        setSettings(fromRow(v.privacySettings));
      })
      .catch(() => setError("Unable to load Privacy Center."));
  }, [apiBaseUrl, accessToken]);

  async function handleSave() {
    setSaveState("saving");
    try {
      await client.update(settings);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  if (error) return <main role="alert">{error}</main>;
  if (!data) return <main>Loading Privacy Center…</main>;

  return (
    <main>
      <header>
        <h1>Privacy Center</h1>
        <div>
          <strong>{data.privacyScore}</strong>
          <span>Privacy score</span>
        </div>
      </header>
      <section>
        <h2>Trusted devices</h2>
        {data.devices.map((d: any) => (
          <article key={d.id}>
            <strong>{d.device_name}</strong>
            <span>
              {d.platform} · {d.status}
            </span>
          </article>
        ))}
      </section>
      <section>
        <h2>Sessions</h2>
        {data.sessions.map((s: any) => (
          <article key={s.id}>
            <strong>{s.revoked_at ? "Revoked" : "Active"}</strong>
            <time>{new Date(s.created_at).toLocaleString()}</time>
          </article>
        ))}
      </section>
      <section>
        <h2>Privacy settings</h2>
        <label>
          Profile visibility
          <select
            value={settings.profileVisibility}
            onChange={(e) =>
              setSettings((s) => ({ ...s, profileVisibility: e.target.value as PrivacySettings["profileVisibility"] }))
            }
          >
            {VISIBILITY_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Last seen visibility
          <select
            value={settings.lastSeenVisibility}
            onChange={(e) =>
              setSettings((s) => ({ ...s, lastSeenVisibility: e.target.value as PrivacySettings["lastSeenVisibility"] }))
            }
          >
            {VISIBILITY_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.phoneDiscoverability}
            onChange={(e) => setSettings((s) => ({ ...s, phoneDiscoverability: e.target.checked }))}
          />
          Discoverable by phone number
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.emailDiscoverability}
            onChange={(e) => setSettings((s) => ({ ...s, emailDiscoverability: e.target.checked }))}
          />
          Discoverable by email
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.usernameDiscoverability}
            onChange={(e) => setSettings((s) => ({ ...s, usernameDiscoverability: e.target.checked }))}
          />
          Discoverable by username
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.readReceipts}
            onChange={(e) => setSettings((s) => ({ ...s, readReceipts: e.target.checked }))}
          />
          Send read receipts
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.typingIndicators}
            onChange={(e) => setSettings((s) => ({ ...s, typingIndicators: e.target.checked }))}
          />
          Show typing indicators
        </label>
        <button onClick={handleSave} disabled={saveState === "saving"}>
          {saveState === "saving" ? "Saving…" : "Save privacy settings"}
        </button>
        {saveState === "saved" && <span> Saved.</span>}
        {saveState === "error" && <span role="alert"> Unable to save.</span>}
      </section>
    </main>
  );
}
