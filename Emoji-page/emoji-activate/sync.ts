import * as FileSystem from "expo-file-system";
import { mark, pending } from "./outbox";
import type { OutboxRow } from "./types";

type Api = {
  baseUrl: string;
  token: string;
};

async function postJson(api: Api, path: string, body: unknown) {
  const response = await fetch(`${api.baseUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${api.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<{ messageId: string; uploadUrl?: string; storageKey?: string }>;
}

export async function flushOutbox(api: Api) {
  const rows = await pending();
  for (const row of rows) {
    try {
      await syncRow(api, row);
      await mark(row.clientId, "synced");
    } catch (error) {
      await mark(row.clientId, "failed", error instanceof Error ? error.message : "sync failed");
    }
  }
}

async function syncRow(api: Api, row: OutboxRow) {
  let storageKey: string | undefined;
  if (row.fileUri && row.mime) {
    const signed = await postJson(api, "/attachments/upload-url", { mime: row.mime, byteSize: row.byteSize, kind: row.kind });
    if (!signed.uploadUrl || !signed.storageKey) throw new Error("Upload URL missing");
    const uploaded = await FileSystem.uploadAsync(signed.uploadUrl, row.fileUri, {
      httpMethod: "PUT",
      headers: { "Content-Type": row.mime },
    });
    if (uploaded.status < 200 || uploaded.status >= 300) throw new Error("File upload failed");
    storageKey = signed.storageKey;
    await mark(row.clientId, "uploaded");
  }
  await postJson(api, "/messages", {
    clientId: row.clientId,
    conversationId: row.conversationId,
    kind: row.kind,
    body: row.body,
    payload: JSON.parse(row.payload),
    file: storageKey
      ? { storageKey, mime: row.mime, byteSize: row.byteSize, width: row.width, height: row.height, durationMs: row.durationMs }
      : null,
  });
}
