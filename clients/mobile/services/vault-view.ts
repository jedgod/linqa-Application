import type { EncryptedVaultItem } from "./vault.service";

export type ItemType = EncryptedVaultItem["item_type"];

/**
 * File names and folders are encrypted on the device, so the server (and this app, without the
 * vault key) only knows each item's type, size, version and creation time. Everything on the
 * vault screens is derived from those fields; nothing here invents names, folders or quotas.
 */
const TYPE_LABEL: Record<ItemType, { single: string; plural: string }> = {
  DOCUMENT: { single: "Document", plural: "Documents" },
  IDENTITY: { single: "Identity document", plural: "Identity" },
  PHOTO: { single: "Photo", plural: "Photos" },
  RECOVERY: { single: "Recovery key", plural: "Recovery" },
  OTHER: { single: "File", plural: "Other files" }
};

export function typeLabel(type: ItemType): string {
  return (TYPE_LABEL[type] ?? TYPE_LABEL.OTHER).single;
}

/** Items of these types sit behind the Private Vault lock. */
export function isPrivateType(type: ItemType): boolean {
  return type === "IDENTITY" || type === "RECOVERY";
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1_048_576) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
}

/** "Today", "Yesterday", "3 days ago", then a short date. */
export function relativeDay(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

export function itemTitle(item: Pick<EncryptedVaultItem, "id" | "item_type">): string {
  return `${typeLabel(item.item_type)} · ${item.id.slice(0, 6).toUpperCase()}`;
}

export interface TypeGroup { type: ItemType; label: string; count: number; latest: string }

/** The folder-like groups shown on My Files: one per item type that has items, newest first. */
export function groupByType(items: EncryptedVaultItem[]): TypeGroup[] {
  const groups = new Map<ItemType, TypeGroup>();
  for (const item of items) {
    const existing = groups.get(item.item_type);
    if (!existing) groups.set(item.item_type, { type: item.item_type, label: (TYPE_LABEL[item.item_type] ?? TYPE_LABEL.OTHER).plural, count: 1, latest: item.created_at });
    else {
      existing.count += 1;
      if (item.created_at > existing.latest) existing.latest = item.created_at;
    }
  }
  return [...groups.values()].sort((a, b) => (a.latest < b.latest ? 1 : -1));
}

export function totalBytes(items: EncryptedVaultItem[]): number {
  return items.reduce((sum, item) => sum + (Number.isFinite(item.encrypted_size) ? item.encrypted_size : 0), 0);
}

export function newestFirst(items: EncryptedVaultItem[]): EncryptedVaultItem[] {
  return [...items].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

export const PRIVATE_AUTO_LOCK_MS = 5 * 60_000;

const FAILURE_TEXT: Record<string, string> = {
  SOCIAL_SOURCE_NOT_CONFIGURED: "Saving from Linqa Social is not connected yet, so this file could not be copied.",
  SCANNER_NOT_CONFIGURED: "No security scanner is connected, so this file was not saved.",
  BLOB_STORE_NOT_CONFIGURED: "Secure storage for imports is not connected yet, so this file was not saved.",
  SOURCE_UNAVAILABLE: "The file could not be fetched. It may have been removed, or you may not have access to it.",
  FILE_TYPE_BLOCKED: "This type of file can not be saved to the vault.",
  FILE_TOO_LARGE: "This file is too large to save.",
  EMPTY_FILE: "This file is empty.",
  QUOTA_EXCEEDED: "Your vault does not have enough free space for this file.",
  SCAN_BLOCKED: "The security scan found a problem with this file, so it was not saved.",
  DLP_BLOCKED: "This file contains content that is not allowed in the vault.",
  SCAN_FAILED: "The security scan could not finish, so this file was not saved.",
  STORAGE_FAILED: "The file could not be stored securely. Try again.",
  PRE_ENCRYPTION_SCAN_CONSENT_REQUIRED: "You need to agree to the security scan before this file can be imported.",
  CLIENT_ENCRYPTION_REQUIRED: "Saving needs on-device encryption, which this version of the app does not have yet.",
  MAIL_NOT_CONFIGURED: "Email sharing is not connected yet. Nothing was sent.",
  BILLING_NOT_CONFIGURED: "Plan changes are not connected yet. You have not been charged.",
  CIPHERTEXT_STORE_NOT_CONFIGURED: "Secure file storage for sharing is not connected yet.",
  SOCIAL_EXPORT_NOT_CONFIGURED: "Sharing to Social is not connected yet. Nothing was shared.",
  VAULT_PRODUCTION_DISABLED: "This feature is not switched on yet.",
  VAULT_FEATURE_DISABLED: "This feature is temporarily switched off.",
  INVALID_RECIPIENT: "That Linqa user could not be found.",
  SHARE_POLICY_DENIED: "Your workspace policy does not allow this kind of sharing.",
  VAULT_OBJECT_NOT_FOUND: "That file could not be found in your vault.",
  PRIVATE_OBJECT_NOT_SHAREABLE_BY_LINK: "Private files can not be shared by link."
};

export function failureText(code: string | null | undefined): string {
  return (code && FAILURE_TEXT[code]) || "This file could not be saved.";
}

export function isFinalImportState(state: string): boolean {
  return state === "AWAITING_CONFIRMATION" || state === "COMPLETED" || state === "VAULTED" || state === "BLOCKED" || state === "FAILED" || state === "PURGED";
}

/** "5 GB", "25 GB", "1 TB" for plan names. */
export function planSize(bytes: number): string {
  const gb = bytes / 1_073_741_824;
  return gb >= 1024 ? `${Math.round(gb / 1024)} TB` : `${Math.round(gb)} GB`;
}

export function planPrice(minor: number, currency: string): string {
  if (minor === 0) return "$0.00";
  const text = `${(minor / 100).toFixed(2)}`;
  return `${currency === "USD" ? "$" : `${currency} `}${text}/mo`;
}
