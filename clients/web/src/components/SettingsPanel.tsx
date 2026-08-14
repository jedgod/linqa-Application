import { useEffect, useMemo, useState } from "react";
import type { LinkedDevice, Profile } from "../types";
import type { SecurityRuntimeState } from "../services/CoreBridge";
import { CoreBridge } from "../services/CoreBridge";
import { formatRelative } from "../utils/format";
import { Avatar } from "./Avatar";
import { BusinessProfileClient } from "../business/BusinessProfileClient";
import { CommunityClient } from "../communities/CommunityClient";
import { EntitlementClient } from "../billing/EntitlementClient";
import { PushRegistrationClient } from "../push/PushRegistrationClient";
import { getApiBaseUrl, getAccessToken } from "../app/apiSession";

const ENTITLEMENT_KEYS = [
  "storage.expanded",
  "calls.highResolution",
  "ai.advanced",
  "support.priority"
];

interface SettingsPanelProps {
  securityState: SecurityRuntimeState;
  onClose: () => void;
}

const PLATFORM_ICON: Record<LinkedDevice["platform"], string> = {
  web: "🌐",
  desktop: "🖥",
  android: "📱",
  ios: "📱",
};

export function SettingsPanel({ securityState, onClose }: SettingsPanelProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [devices, setDevices] = useState<LinkedDevice[]>([]);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  const apiBaseUrl = getApiBaseUrl();
  const getToken = () => Promise.resolve(getAccessToken());
  const businessClient = useMemo(() => new BusinessProfileClient(apiBaseUrl, getToken), [apiBaseUrl]);
  const communityClient = useMemo(() => new CommunityClient(apiBaseUrl, getToken), [apiBaseUrl]);
  const entitlementClient = useMemo(() => new EntitlementClient(apiBaseUrl, getToken), [apiBaseUrl]);
  const pushClient = useMemo(() => new PushRegistrationClient(apiBaseUrl, getToken), [apiBaseUrl]);

  const [businessForm, setBusinessForm] = useState({ displayName: "", category: "", description: "", website: "" });
  const [businessStatus, setBusinessStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const [communityForm, setCommunityForm] = useState<{ name: string; visibility: "PRIVATE" | "INVITE_ONLY" | "PUBLIC" }>({
    name: "",
    visibility: "PRIVATE"
  });
  const [communityStatus, setCommunityStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const [entitlements, setEntitlements] = useState<Record<string, boolean> | null>(null);
  const [pushStatus, setPushStatus] = useState<"idle" | "requesting" | "enabled" | "unavailable" | "error">("idle");

  useEffect(() => {
    CoreBridge.getProfile().then(setProfile);
    CoreBridge.listDevices().then(setDevices);
  }, []);

  useEffect(() => {
    Promise.all(ENTITLEMENT_KEYS.map((key) => entitlementClient.has(key).then((enabled) => [key, enabled] as const)))
      .then((pairs) => setEntitlements(Object.fromEntries(pairs)))
      .catch(() => setEntitlements(null));
  }, [entitlementClient]);

  async function handleSaveBusinessProfile() {
    setBusinessStatus("saving");
    try {
      await businessClient.save(businessForm);
      setBusinessStatus("saved");
    } catch {
      setBusinessStatus("error");
    }
  }

  async function handleCreateCommunity() {
    setCommunityStatus("saving");
    try {
      await communityClient.create(communityForm);
      setCommunityStatus("saved");
      setCommunityForm((f) => ({ ...f, name: "" }));
    } catch {
      setCommunityStatus("error");
    }
  }

  async function handleEnablePush() {
    setPushStatus("requesting");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setPushStatus("unavailable");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushStatus("unavailable");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true });
      const json = subscription.toJSON();
      await pushClient.registerWebPush({
        endpoint: json.endpoint ?? "",
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
        appBundle: "linqa-web"
      });
      setPushStatus("enabled");
    } catch {
      setPushStatus("unavailable");
    }
  }

  async function handleLinkDevice() {
    setLinking(true);
    setLinkCode(null);
    const { linkCode } = await CoreBridge.beginDeviceLink();
    setLinkCode(linkCode);
    setLinking(false);
  }

  const pqActive = securityState.kind === "ready" && securityState.pqcActive;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {profile && (
          <div className="settings-section">
            <h3>Profile</h3>
            <div className="profile-row">
              <Avatar initials="YOU" hue={230} size={44} />
              <div>
                <div className="profile-name">{profile.displayName}</div>
                <div className="profile-username">{profile.username}</div>
              </div>
            </div>
          </div>
        )}

        {profile && (
          <div className="settings-section">
            <h3>Security</h3>
            {pqActive ? (
              <span className="pq-pill">🛡 Post-quantum encryption active</span>
            ) : (
              <span className="pq-pill pq-pill--inactive">
                ⚠ {securityState.kind === "demo" ? "Demo mode — not encrypted" : "Secure core unavailable"}
              </span>
            )}
            <div className="fingerprint">{profile.fingerprint}</div>
          </div>
        )}

        <div className="settings-section">
          <h3>Linked devices</h3>
          {devices.map((d) => (
            <div className="device-row" key={d.id}>
              <div className="device-icon">{PLATFORM_ICON[d.platform]}</div>
              <div className="device-info">
                <div className="device-name">{d.name}</div>
                <div className="device-sub">
                  Active {d.isCurrent ? "now" : `${formatRelative(d.lastActive)} ago`}
                </div>
              </div>
              {d.isCurrent && <span className="current-tag">THIS DEVICE</span>}
            </div>
          ))}

          <button className="link-device-btn" onClick={handleLinkDevice} disabled={linking}>
            {linking ? "Generating code…" : "+ Link a new device"}
          </button>

          {linkCode && (
            <div className="link-code-box">
              <div className="link-code">{linkCode}</div>
              <div className="link-code-note">
                Enter this code on the new device. It expires in 5 minutes.
              </div>
            </div>
          )}
        </div>

        <div className="settings-section">
          <h3>Notifications</h3>
          <button onClick={handleEnablePush} disabled={pushStatus === "requesting" || pushStatus === "enabled"}>
            {pushStatus === "enabled" ? "Push notifications enabled" : pushStatus === "requesting" ? "Requesting…" : "Enable push notifications"}
          </button>
          {pushStatus === "unavailable" && <div className="pq-pill pq-pill--inactive">⚠ Push provider unavailable in this environment</div>}
          {pushStatus === "error" && <div role="alert">Unable to register for push notifications.</div>}
        </div>

        <div className="settings-section">
          <h3>Premium</h3>
          {entitlements === null ? (
            <div>Unable to load entitlements.</div>
          ) : (
            ENTITLEMENT_KEYS.map((key) => (
              <div className="device-row" key={key}>
                <div className="device-info">
                  <div className="device-name">{key}</div>
                </div>
                <span className={entitlements[key] ? "pq-pill" : "pq-pill pq-pill--inactive"}>
                  {entitlements[key] ? "Enabled" : "Not enabled"}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="settings-section">
          <h3>Business profile</h3>
          <input
            placeholder="Business name"
            value={businessForm.displayName}
            onChange={(e) => setBusinessForm((f) => ({ ...f, displayName: e.target.value }))}
          />
          <input
            placeholder="Category"
            value={businessForm.category}
            onChange={(e) => setBusinessForm((f) => ({ ...f, category: e.target.value }))}
          />
          <input
            placeholder="Description"
            value={businessForm.description}
            onChange={(e) => setBusinessForm((f) => ({ ...f, description: e.target.value }))}
          />
          <input
            placeholder="Website"
            value={businessForm.website}
            onChange={(e) => setBusinessForm((f) => ({ ...f, website: e.target.value }))}
          />
          <button
            onClick={handleSaveBusinessProfile}
            disabled={businessStatus === "saving" || !businessForm.displayName || !businessForm.category}
          >
            {businessStatus === "saving" ? "Saving…" : "Save business profile"}
          </button>
          {businessStatus === "saved" && <span> Saved.</span>}
          {businessStatus === "error" && <span role="alert"> Unable to save.</span>}
        </div>

        <div className="settings-section">
          <h3>Communities</h3>
          <input
            placeholder="Community name"
            value={communityForm.name}
            onChange={(e) => setCommunityForm((f) => ({ ...f, name: e.target.value }))}
          />
          <select
            value={communityForm.visibility}
            onChange={(e) => setCommunityForm((f) => ({ ...f, visibility: e.target.value as typeof f.visibility }))}
          >
            <option value="PRIVATE">Private</option>
            <option value="INVITE_ONLY">Invite only</option>
            <option value="PUBLIC">Public</option>
          </select>
          <button onClick={handleCreateCommunity} disabled={communityStatus === "saving" || !communityForm.name}>
            {communityStatus === "saving" ? "Creating…" : "Create community"}
          </button>
          {communityStatus === "saved" && <span> Created.</span>}
          {communityStatus === "error" && <span role="alert"> Unable to create.</span>}
        </div>
      </div>
    </div>
  );
}
