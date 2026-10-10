import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileVaultClient, type VaultItemSummary, type VaultItemType } from "../vault/FileVaultClient";

const ITEM_TYPES: VaultItemType[] = ["DOCUMENT", "IDENTITY", "PHOTO", "RECOVERY", "OTHER"];

const PLANS = [
  { id: "free", name: "5 GB", bytes: 5 * 1024 ** 3, price: "$0.00" },
  { id: "25", name: "25 GB", bytes: 25 * 1024 ** 3, price: "$1.99/mo" },
  { id: "40", name: "40 GB", bytes: 40 * 1024 ** 3, price: "$2.99/mo" },
  { id: "60", name: "60 GB", bytes: 60 * 1024 ** 3, price: "$3.99/mo" },
  { id: "100", name: "100 GB", bytes: 100 * 1024 ** 3, price: "$5.99/mo" },
  { id: "250", name: "250 GB", bytes: 250 * 1024 ** 3, price: "$9.99/mo" },
  { id: "1tb", name: "1 TB", bytes: 1024 ** 4, price: "$14.99/mo" }
] as const;

const CURRENT_PLAN_ID: (typeof PLANS)[number]["id"] = "60";

type VaultScreen =
  | "home"
  | "files"
  | "intake"
  | "save"
  | "private"
  | "share"
  | "plans"
  | "security";

type PendingUpload = { file: File; folder: string; tags: string[] };

function folderOf(item: VaultItemSummary): string {
  const value = item.metadata?.folder;
  return typeof value === "string" && value.trim() ? value : "Uncategorized";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function fileGlyph(item: VaultItemSummary): string {
  if (item.itemType === "PHOTO") return "🖼️";
  const name = item.name.toLowerCase();
  if (name.endsWith(".pdf")) return "📕";
  if (name.endsWith(".xlsx") || name.endsWith(".csv")) return "📊";
  if (name.endsWith(".doc") || name.endsWith(".docx")) return "📄";
  return "📁";
}

export function FileVaultPage({ apiBaseUrl, accessToken }: { apiBaseUrl: string; accessToken: string }) {
  const [client] = useState(() => new FileVaultClient(apiBaseUrl, () => Promise.resolve(accessToken)));
  const [items, setItems] = useState<VaultItemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<VaultScreen>("home");
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [shareItem, setShareItem] = useState<VaultItemSummary | null>(null);
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [scanStage, setScanStage] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    client
      .list()
      .then(setItems)
      .catch(() => setError("Unable to load vault items."))
      .finally(() => setLoading(false));
  }, [client]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const usedBytes = useMemo(() => items.reduce((sum, item) => sum + item.encryptedSize, 0), [items]);
  const plan = PLANS.find((p) => p.id === CURRENT_PLAN_ID)!;
  const usedPct = Math.min(100, Math.round((usedBytes / plan.bytes) * 100));

  const folders = useMemo(() => {
    const byFolder = new Map<string, VaultItemSummary[]>();
    for (const item of items) {
      const key = folderOf(item);
      if (!byFolder.has(key)) byFolder.set(key, []);
      byFolder.get(key)!.push(item);
    }
    return [...byFolder.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  function pickFile() {
    fileInput.current?.click();
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPending({ file, folder: activeFolder ?? "Uncategorized", tags: [] });
    setScreen("save");
  }

  async function confirmSave(itemType: VaultItemType) {
    if (!pending) return;
    setScanError(null);
    try {
      setScanStage(1); // Reading file
      const content = new Uint8Array(await pending.file.arrayBuffer());
      setScanStage(2); // Encrypting (real AES-GCM happens inside client.upload)
      setScanStage(3); // Computing integrity hash (real, inside client.upload)
      await client.upload({
        itemType,
        name: pending.file.name,
        metadata: { originalSize: pending.file.size, folder: pending.folder, tags: pending.tags },
        content,
        contentType: pending.file.type || "application/octet-stream"
      });
      setScanStage(4); // Uploading to secure storage
      setPending(null);
      refresh();
      setScreen("files");
    } catch {
      setScanError("This file could not be saved to your vault. Nothing was stored.");
    } finally {
      setScanStage(0);
    }
  }

  async function handleDownload(item: VaultItemSummary) {
    setError(null);
    try {
      const bytes = await client.download(item.id, item.itemType);
      const blob = new Blob([bytes as unknown as BlobPart], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Unable to download this item — integrity check failed or the object is unavailable.");
    }
  }

  return (
    <div className="vault">
      <input ref={fileInput} type="file" style={{ display: "none" }} onChange={onFilePicked} />
      {screen === "home" && (
        <VaultHome
          usedBytes={usedBytes}
          plan={plan}
          usedPct={usedPct}
          items={items}
          loading={loading}
          error={error}
          onUpload={pickFile}
          onOpenFiles={() => setScreen("files")}
          onOpenIntake={() => setScreen("intake")}
          onOpenShare={(item) => {
            setShareItem(item);
            setScreen("share");
          }}
          onOpenPrivate={() => setScreen("private")}
          onOpenPlans={() => setScreen("plans")}
        />
      )}
      {screen === "files" && (
        <VaultFiles
          folders={folders}
          activeFolder={activeFolder}
          onOpenFolder={setActiveFolder}
          onBack={() => setScreen("home")}
          onDownload={handleDownload}
          onShare={(item) => {
            setShareItem(item);
            setScreen("share");
          }}
        />
      )}
      {screen === "intake" && (
        <VaultIntake onBack={() => setScreen("home")} onFromDevice={pickFile} />
      )}
      {screen === "save" && pending && (
        <VaultSave
          pending={pending}
          folders={folders.map(([name]) => name)}
          scanStage={scanStage}
          scanError={scanError}
          onChangeFolder={(folder) => setPending({ ...pending, folder })}
          onChangeTags={(tags) => setPending({ ...pending, tags })}
          onCancel={() => {
            setPending(null);
            setScreen("home");
          }}
          onConfirm={confirmSave}
        />
      )}
      {screen === "private" && (
        <VaultPrivate onBack={() => setScreen("home")} />
      )}
      {screen === "share" && shareItem && (
        <VaultShare item={shareItem} onBack={() => setScreen(activeFolder ? "files" : "home")} />
      )}
      {screen === "plans" && (
        <VaultPlans usedBytes={usedBytes} currentPlanId={CURRENT_PLAN_ID} onBack={() => setScreen("home")} />
      )}
      {screen === "security" && <VaultSecurityCenter onBack={() => setScreen("home")} />}
      <nav className="vault-nav">
        <button className={screen === "home" ? "active" : ""} onClick={() => setScreen("home")}>
          Home
        </button>
        <button className={screen === "files" ? "active" : ""} onClick={() => setScreen("files")}>
          Files
        </button>
        <button className="vault-nav-fab" onClick={pickFile} aria-label="Upload">
          +
        </button>
        <button className={screen === "share" ? "active" : ""} onClick={() => setScreen("intake")}>
          Add
        </button>
        <button className={screen === "security" ? "active" : ""} onClick={() => setScreen("security")}>
          Security
        </button>
      </nav>
    </div>
  );
}

function VaultHome({
  usedBytes,
  plan,
  usedPct,
  items,
  loading,
  error,
  onUpload,
  onOpenFiles,
  onOpenIntake,
  onOpenShare,
  onOpenPrivate,
  onOpenPlans
}: {
  usedBytes: number;
  plan: (typeof PLANS)[number];
  usedPct: number;
  items: VaultItemSummary[];
  loading: boolean;
  error: string | null;
  onUpload(): void;
  onOpenFiles(): void;
  onOpenIntake(): void;
  onOpenShare(item: VaultItemSummary): void;
  onOpenPrivate(): void;
  onOpenPlans(): void;
}) {
  const recent = items.slice(0, 5);
  return (
    <div className="vault-screen">
      <div className="vault-header">
        <div className="vault-logo">🔒</div>
        <h1>Linqa Vault</h1>
      </div>
      <div className="vault-card">
        <div className="vault-label">Storage used</div>
        <div className="vault-storage-row">
          <span className="vault-storage-value">{formatBytes(usedBytes)}</span>
          <span className="vault-storage-total"> / {plan.name}</span>
          <span className="vault-storage-pct">{usedPct}%</span>
        </div>
        <div className="vault-progress">
          <div className="vault-progress-fill" style={{ width: `${usedPct}%` }} />
        </div>
        <button className="vault-link-btn" onClick={onOpenPlans}>
          Upgrade Plan
        </button>
      </div>

      <div className="vault-section-title">Quick Actions</div>
      <div className="vault-quick-actions">
        <button onClick={onUpload}>
          <span>⬆️</span>Upload Files
        </button>
        <button onClick={onOpenIntake}>
          <span>📥</span>Intake Center
        </button>
        <button onClick={() => recent[0] && onOpenShare(recent[0])} disabled={recent.length === 0}>
          <span>🔗</span>Secure Share
        </button>
        <button onClick={onOpenPrivate}>
          <span>🔐</span>Private Vault
        </button>
      </div>

      <div className="vault-section-title-row">
        <span>Recent Files</span>
        <button className="vault-link-btn" onClick={onOpenFiles}>
          See All
        </button>
      </div>
      {loading && <p className="vault-muted">Loading…</p>}
      {error && (
        <p className="vault-muted" role="alert">
          {error}
        </p>
      )}
      {!loading && recent.length === 0 && <p className="vault-muted">No items in your vault yet.</p>}
      <div className="vault-card vault-list">
        {recent.map((item) => (
          <div className="vault-row" key={item.id}>
            <span className="vault-file-icon">{fileGlyph(item)}</span>
            <div className="vault-row-body">
              <div className="vault-row-title">{item.name}</div>
              <div className="vault-row-sub">
                {formatBytes(item.encryptedSize)} · {new Date(item.createdAt).toLocaleDateString()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VaultFiles({
  folders,
  activeFolder,
  onOpenFolder,
  onBack,
  onDownload,
  onShare
}: {
  folders: [string, VaultItemSummary[]][];
  activeFolder: string | null;
  onOpenFolder(name: string | null): void;
  onBack(): void;
  onDownload(item: VaultItemSummary): void;
  onShare(item: VaultItemSummary): void;
}) {
  const openItems = activeFolder ? folders.find(([name]) => name === activeFolder)?.[1] ?? [] : [];
  return (
    <div className="vault-screen">
      <VaultPageHeader
        title={activeFolder ?? "My Files"}
        onBack={activeFolder ? () => onOpenFolder(null) : onBack}
      />
      {!activeFolder && (
        <>
          <div className="vault-section-title">All Folders</div>
          <div className="vault-card vault-list">
            {folders.map(([name, folderItems]) => (
              <button className="vault-row vault-row-btn" key={name} onClick={() => onOpenFolder(name)}>
                <span className="vault-file-icon">📁</span>
                <div className="vault-row-body">
                  <div className="vault-row-title">{name}</div>
                  <div className="vault-row-sub">{folderItems.length} items</div>
                </div>
                <span className="vault-chevron">›</span>
              </button>
            ))}
            {folders.length === 0 && <p className="vault-muted">No files yet.</p>}
          </div>
        </>
      )}
      {activeFolder && (
        <div className="vault-card vault-list">
          {openItems.map((item) => (
            <div className="vault-row" key={item.id}>
              <span className="vault-file-icon">{fileGlyph(item)}</span>
              <div className="vault-row-body">
                <div className="vault-row-title">{item.name}</div>
                <div className="vault-row-sub">{formatBytes(item.encryptedSize)}</div>
              </div>
              <button className="vault-link-btn" onClick={() => onDownload(item)}>
                Download
              </button>
              <button className="vault-link-btn" onClick={() => onShare(item)}>
                Share
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VaultIntake({ onBack, onFromDevice }: { onBack(): void; onFromDevice(): void }) {
  const sources = [
    { icon: "💬", title: "From Linqa Social", subtitle: "Save posts, attachments", available: false },
    { icon: "✉️", title: "From Messages", subtitle: "Save message attachments", available: false },
    { icon: "💼", title: "From Client / Business", subtitle: "Save files from clients", available: false },
    { icon: "📱", title: "From Device", subtitle: "Upload from this device", available: true },
    { icon: "🔗", title: "From External Link", subtitle: "Secure link or shared file", available: false },
    { icon: "🖨️", title: "Scan Document", subtitle: "Scan and save to vault", available: false }
  ];
  return (
    <div className="vault-screen">
      <VaultPageHeader title="Intake Center" subtitle="Bring files into your secure vault" onBack={onBack} />
      <div className="vault-list-spaced">
        {sources.map((source) => (
          <button
            key={source.title}
            className="vault-card vault-row vault-row-btn"
            disabled={!source.available}
            onClick={source.available ? onFromDevice : undefined}
          >
            <span className="vault-source-icon">{source.icon}</span>
            <div className="vault-row-body">
              <div className="vault-row-title">{source.title}</div>
              <div className="vault-row-sub">
                {source.available ? source.subtitle : "Requires connecting this source — not set up yet"}
              </div>
            </div>
            <span className="vault-chevron">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function VaultSave({
  pending,
  folders,
  scanStage,
  scanError,
  onChangeFolder,
  onChangeTags,
  onCancel,
  onConfirm
}: {
  pending: PendingUpload;
  folders: string[];
  scanStage: number;
  scanError: string | null;
  onChangeFolder(folder: string): void;
  onChangeTags(tags: string[]): void;
  onCancel(): void;
  onConfirm(itemType: VaultItemType): void;
}) {
  const [itemType, setItemType] = useState<VaultItemType>("DOCUMENT");
  const [tagInput, setTagInput] = useState("");
  const stages = ["Reading file", "Encrypting on this device", "Computing integrity hash", "Uploading to secure storage"];
  const busy = scanStage > 0;

  return (
    <div className="vault-screen">
      <VaultPageHeader title={busy ? "Securing your file…" : "Save to Vault"} onBack={busy ? undefined : onCancel} />
      {busy ? (
        <div className="vault-scan">
          <div className="vault-scan-ring">🛡️</div>
          <div className="vault-scan-title">{pending.file.name}</div>
          <div className="vault-scan-steps">
            {stages.map((stage, i) => (
              <div className="vault-scan-step" key={stage}>
                <span className={i < scanStage ? "vault-step-done" : i === scanStage - 1 ? "vault-step-active" : ""}>
                  {i < scanStage ? "✓" : "○"}
                </span>
                <span>{stage}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="vault-form">
          <div className="vault-card vault-row">
            <span className="vault-file-icon">📄</span>
            <div className="vault-row-body">
              <div className="vault-row-title">{pending.file.name}</div>
              <div className="vault-row-sub">{formatBytes(pending.file.size)}</div>
            </div>
          </div>

          {scanError && (
            <p className="vault-error" role="alert">
              {scanError}
            </p>
          )}

          <label className="vault-label" htmlFor="vault-item-type">
            Type
          </label>
          <select id="vault-item-type" className="vault-input" value={itemType} onChange={(e) => setItemType(e.target.value as VaultItemType)}>
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <label className="vault-label" htmlFor="vault-folder">
            Save to folder
          </label>
          <input
            id="vault-folder"
            className="vault-input"
            list="vault-folder-options"
            value={pending.folder}
            onChange={(e) => onChangeFolder(e.target.value)}
          />
          <datalist id="vault-folder-options">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>

          <label className="vault-label">Tags (optional)</label>
          <div className="vault-tags">
            {pending.tags.map((tag) => (
              <span className="vault-tag" key={tag}>
                {tag}
                <button onClick={() => onChangeTags(pending.tags.filter((t) => t !== tag))} aria-label={`Remove ${tag}`}>
                  ×
                </button>
              </span>
            ))}
            <input
              className="vault-tag-input"
              placeholder="Add tag"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && tagInput.trim()) {
                  onChangeTags([...pending.tags, tagInput.trim()]);
                  setTagInput("");
                  e.preventDefault();
                }
              }}
            />
          </div>

          <div className="vault-notice">🛡️ This file is encrypted on your device before it ever leaves it.</div>

          <button className="vault-primary-btn" onClick={() => onConfirm(itemType)}>
            Save Now
          </button>
          <button className="vault-link-btn vault-center" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function VaultPrivate({ onBack }: { onBack(): void }) {
  return <div className="vault-screen"><VaultPageHeader title="Private Vault" onBack={onBack} /><div className="vault-private-lock"><h2>Unlock in the Linqa mobile app</h2><p className="vault-muted">Identity and recovery files require device biometric signing and a server-confirmed Private Vault session.</p><p className="vault-muted">This browser has no Linqa hardware signing bridge. Open Private Vault on your enrolled mobile device.</p></div></div>;
}

function VaultShare({ item, onBack }: { item: VaultItemSummary; onBack(): void }) {
  const options = [
    { icon: "👤", title: "Linqa User", subtitle: "Share securely with a Linqa user", available: false },
    { icon: "🔁", title: "Vault-to-Vault Transfer", subtitle: "Send directly to another vault", available: false },
    { icon: "🔗", title: "Secure Link", subtitle: "Create a secure share link", available: false },
    { icon: "✉️", title: "Email", subtitle: "Send via email", available: false },
    { icon: "↗️", title: "Export to Social (Copy)", subtitle: "Share a copy to Linqa Social", available: false }
  ];
  return (
    <div className="vault-screen">
      <VaultPageHeader title="Share" onBack={onBack} />
      <div className="vault-card vault-row">
        <span className="vault-file-icon">{fileGlyph(item)}</span>
        <div className="vault-row-body">
          <div className="vault-row-title">{item.name}</div>
          <div className="vault-row-sub">{formatBytes(item.encryptedSize)}</div>
        </div>
      </div>
      <div className="vault-section-title">Share to</div>
      <div className="vault-list-spaced">
        {options.map((opt) => (
          <div className="vault-card vault-row" key={opt.title}>
            <span className="vault-source-icon">{opt.icon}</span>
            <div className="vault-row-body">
              <div className="vault-row-title">{opt.title}</div>
              <div className="vault-row-sub">Not connected yet — {opt.subtitle.toLowerCase()}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="vault-notice">
        🛡️ Vault cannot expose information out to Social or contacts without an explicit, backend-authorized export —
        that export gateway isn't wired up yet, so sharing is disabled rather than simulated.
      </p>
    </div>
  );
}

function VaultPlans({
  usedBytes,
  currentPlanId,
  onBack
}: {
  usedBytes: number;
  currentPlanId: string;
  onBack(): void;
}) {
  const current = PLANS.find((p) => p.id === currentPlanId)!;
  const usedPct = Math.min(100, Math.round((usedBytes / current.bytes) * 100));
  return (
    <div className="vault-screen">
      <VaultPageHeader title="Storage Plans" subtitle="Choose the plan that fits you" onBack={onBack} />
      <div className="vault-card">
        <div className="vault-label">Current Plan</div>
        <div className="vault-storage-row">
          <div>
            <div className="vault-storage-value">{current.name} Plan</div>
            <div className="vault-row-sub">
              {formatBytes(usedBytes)} / {current.name} used
            </div>
          </div>
        </div>
        <div className="vault-progress">
          <div className="vault-progress-fill" style={{ width: `${usedPct}%` }} />
        </div>
      </div>
      <div className="vault-list-spaced">
        {PLANS.map((plan) => (
          <div className={`vault-plan-row${plan.id === currentPlanId ? " vault-plan-current" : ""}`} key={plan.id}>
            <span className="vault-plan-dot">{plan.id === currentPlanId ? "●" : "○"}</span>
            <span className="vault-row-title">{plan.name}</span>
            <span>{plan.price}</span>
          </div>
        ))}
      </div>
      <p className="vault-notice">
        🛡️ Plan changes require a connected billing provider, which isn't wired up in this environment — this view is
        informational only.
      </p>
    </div>
  );
}

function VaultSecurityCenter({ onBack }: { onBack(): void }) {
  const items: [string, string, boolean][] = [
    ["End-to-End Encryption", "Enabled", true],
    ["Integrity Verification", "Enabled", true],
    ["Two-Factor Authentication", "Managed in account settings", false],
    ["Biometric Login", "Not available on this device/browser", false],
    ["Trusted Devices", "Managed in account settings", false],
    ["Auto-lock (Private Vault)", "5 minutes on the mobile app", true]
  ];
  return (
    <div className="vault-screen">
      <VaultPageHeader title="Security Center" onBack={onBack} />
      <div className="vault-security-badge">
        <div className="vault-security-badge-icon">✅</div>
        <div className="vault-security-badge-title">Vault content is encrypted client-side</div>
        <div className="vault-muted">Every file is encrypted before it leaves this device.</div>
      </div>
      <div className="vault-section-title">Security Features</div>
      <div className="vault-card vault-list">
        {items.map(([label, value, positive]) => (
          <div className="vault-row" key={label}>
            <div className="vault-row-body">
              <div className="vault-row-title">{label}</div>
            </div>
            <span className={positive ? "vault-status-good" : "vault-status-neutral"}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function VaultPageHeader({
  title,
  subtitle,
  onBack,
  extra
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="vault-page-header">
      {onBack && (
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
      )}
      <div className="vault-page-header-text">
        <h1>{title}</h1>
        {subtitle && <p className="vault-muted">{subtitle}</p>}
      </div>
      {extra}
    </div>
  );
}
