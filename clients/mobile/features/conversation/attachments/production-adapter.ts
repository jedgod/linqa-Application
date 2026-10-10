import * as FS from "expo-file-system/legacy";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { base64ToBytes, bytesToBase64 } from "../../../services/secure-core";
import { encryptMediaBytes, decryptMediaBytes } from "../../../services/conversation-file-crypto";
import { AttachmentService, MAX_FILE_BYTES, type NativeFileCrypto } from "./AttachmentService";
import type { ConversationServiceLike } from "../../../services/conversation-types";

export function createFeatureAttachments(service: ConversationServiceLike, conversationId: string, isLive: () => boolean): AttachmentService {
  const context = (details?: { blobId: string; mime: string }) => {
    if (!details || !isLive()) throw new Error("SECURE_CORE_UNAVAILABLE");
    return { conversationId, senderUserId: "linqa-feature-file-v1", mediaId: details.blobId, mimeType: details.mime };
  };
  const read = async (path: string, max = MAX_FILE_BYTES) => {
    const info = await FS.getInfoAsync(path);
    if (!info.exists || !Number.isSafeInteger(info.size) || info.size <= 0 || info.size > max) throw new Error("FILE_TOO_LARGE");
    return FS.readAsStringAsync(path, { encoding: FS.EncodingType.Base64 });
  };
  const crypto: NativeFileCrypto = {
    async encryptFile(source, target, details) {
      const { getRandomBytesAsync } = await import("expo-crypto");
      const data = await read(source);
      const key = await getRandomBytesAsync(32); const nonce = await getRandomBytesAsync(24);
      const bytes = base64ToBytes(data);
      try {
        const sealed = encryptMediaBytes(data, context(details), key, nonce);
        await FS.writeAsStringAsync(target, sealed.envelope, { encoding: FS.EncodingType.Base64 });
        return { key: sealed.key, nonce: bytesToBase64(nonce), sha256: bytesToHex(sha256(bytes)), size: bytes.length };
      } finally { key.fill(0); bytes.fill(0); }
    },
    async decryptFile(source, target, key, nonce, details) {
      const data = await read(source, MAX_FILE_BYTES + 40);
      if (bytesToBase64(base64ToBytes(data).subarray(0,24)) !== nonce) throw new Error("FILE_INTEGRITY_FAILED");
      const plain = decryptMediaBytes(data, key, context(details));
      await FS.writeAsStringAsync(target, plain, { encoding: FS.EncodingType.Base64 });
    },
    async sha256File(path) {
      const bytes = base64ToBytes(await read(path));
      try { return bytesToHex(sha256(bytes)); } finally { bytes.fill(0); }
    }
  };
  return new AttachmentService(crypto, {
    async upload(path, progress, id) {
      if (!id || !isLive() || !service.uploadFeatureBlob) throw new Error("SECURE_CORE_UNAVAILABLE");
      await service.uploadFeatureBlob(conversationId, id, await read(path, MAX_FILE_BYTES + 40));
      progress?.(1); return id;
    },
    async download(id, path, progress) {
      if (!isLive() || !service.downloadFeatureBlob) throw new Error("SECURE_CORE_UNAVAILABLE");
      const data = await service.downloadFeatureBlob(conversationId, id);
      if (!isLive() || data.length > Math.ceil((MAX_FILE_BYTES + 40) / 3) * 4) throw new Error("FILE_TOO_LARGE");
      await FS.writeAsStringAsync(path, data, { encoding: FS.EncodingType.Base64 });
      progress?.(1);
    }
  }, isLive);
}
