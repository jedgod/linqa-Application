import { getApiBaseUrl } from "../config/api";
import { AccountSecureStorage } from "../account/AccountSecureStorage";
import { base64ToBytes, bytesToBase64 } from "./secure-core";
import { accessTokenProvider } from "./session";
import { sealVaultItem, type VaultItemDetails } from "./vault-crypto";
import { accountScopeGeneration } from './account-scope';

const storage = new AccountSecureStorage();
const VAULT_KEY = "vault.key.v1";

/** This account's vault key. Created on first use and kept only in the phone's secure storage. */
async function vaultKeyFor(accountId: string, random: (n: number) => Uint8Array): Promise<Uint8Array> {
  const existing = await storage.get(accountId, VAULT_KEY);
  if (existing) {
    const bytes = base64ToBytes(existing);
    if (bytes.length === 32) return bytes;
  }
  const created = random(32);
  await storage.put(accountId, VAULT_KEY, bytesToBase64(created));
  return created;
}

const KIND_TO_ITEM_TYPE = { PHOTO: "PHOTO", VIDEO: "OTHER", VOICE: "OTHER", FILE: "DOCUMENT" } as const;

export class VaultSaveError extends Error {}

/**
 * Encrypts a capture on this phone and stores it in LinqaVault. `plainBase64` is the file's bytes; nothing readable is sent.
 * The vault key stays on this phone, so these files can only be opened here (or on a device the key is later restored to).
 */
export async function saveToVault(input: { accountId: string; plainBase64: string; details: Omit<VaultItemDetails, "size" | "createdAt"> }): Promise<string> {
  const generation = accountScopeGeneration();
  const assertScope = () => { if (generation !== accountScopeGeneration()) throw new VaultSaveError('Account changed. Choose the file again.'); };
  const { getRandomBytes } = await import("expo-crypto");
  const random = (n: number) => getRandomBytes(n);
  const plain = base64ToBytes(input.plainBase64);
  const vaultKey = await vaultKeyFor(input.accountId, random);
  let sealed;
  try {
    assertScope();
    sealed = sealVaultItem(plain, { ...input.details, size: plain.length, createdAt: new Date().toISOString() }, vaultKey, random);
  } finally {
    plain.fill(0);
    vaultKey.fill(0);
  }

  const base = getApiBaseUrl();
  let token: string;
  try { token = await accessTokenProvider.getAccessToken(); } catch { throw new VaultSaveError("Sign in again to save to your vault."); }
  assertScope();

  let begin: Response;
  try {
    begin = await fetch(`${base}/v1/vault/items`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        itemType: KIND_TO_ITEM_TYPE[input.details.kind],
        nameCiphertextBase64: bytesToBase64(sealed.name),
        metadataCiphertextBase64: bytesToBase64(sealed.details),
        keyEnvelopeBase64: bytesToBase64(sealed.keyEnvelope),
        contentHashBase64: bytesToBase64(sealed.contentHash),
        encryptedSize: sealed.content.length,
        contentType: "application/octet-stream"
      })
    });
  } catch {
    throw new VaultSaveError("No connection to Linqa. Check your network and try again.");
  }
  if (!begin.ok) {
    throw new VaultSaveError(begin.status === 403 || begin.status === 401 ? "This account is not allowed to use the vault." : "The vault could not accept this file right now.");
  }
  const ticket = (await begin.json()) as { itemId: string; uploadUrl: string; headers?: Record<string, string> };
  assertScope();

  let put: Response;
  try {
    // A relative address means the API itself receives the bytes (development storage); otherwise it is the storage service's own URL.
    put = await fetch(ticket.uploadUrl.startsWith("/") ? `${base}${ticket.uploadUrl}` : ticket.uploadUrl, { method: "PUT", headers: ticket.headers ?? {}, body: sealed.content as unknown as BodyInit });
  } catch {
    throw new VaultSaveError("The upload was interrupted. Try again.");
  }
  if (!put.ok) throw new VaultSaveError("The vault could not store this file. Try again.");
  return ticket.itemId;
}
