export interface AttachmentCryptoCore {
  encryptAttachment(input: {
    attachmentId: string;
    fileName: string;
    mediaType: string;
    bytes: Uint8Array;
  }): Promise<{
    manifestBytes: Uint8Array;
    attachmentKey: Uint8Array;
    encryptedChunks: Uint8Array[];
  }>;
}

export class AttachmentClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getAccessToken: () => Promise<string>,
    private readonly cryptoCore: AttachmentCryptoCore
  ) {}

  async prepare(file: File) {
    if (file.size <= 0 || file.size > 500 * 1024 * 1024) {
      throw new Error("Attachment size is not allowed.");
    }

    const attachmentId = crypto.randomUUID();
    const bytes = new Uint8Array(await file.arrayBuffer());

    return this.cryptoCore.encryptAttachment({
      attachmentId,
      fileName: file.name,
      mediaType: file.type || "application/octet-stream",
      bytes
    });
  }

  async createUpload(input: {
    mediaType: string;
    ciphertextSize: number;
    chunkCount: number;
    manifestHashBase64: string;
  }) {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.apiBaseUrl}/v1/attachments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      throw new Error("Unable to create encrypted attachment upload.");
    }

    return response.json();
  }
}
