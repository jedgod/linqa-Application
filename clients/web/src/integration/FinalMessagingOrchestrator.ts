export interface CryptoCore {
  runtimeInfo(): Promise<{
    secureCoreReady: boolean;
    apiVersion: number;
    protocolVersion: number;
  }>;
  encryptMessage(input: {
    recipientUserId: string;
    recipientDeviceId: string;
    recipientKeyPackageBase64: string;
    messageId: string;
    plaintext: string;
    createdAtUnix: number;
    expiresAtUnix: number;
  }): Promise<Uint8Array>;
  decryptMessage(ciphertext: Uint8Array): Promise<{
    messageId: string;
    senderUserId: string;
    senderDeviceId: string;
    plaintext: string;
  }>;
}

export interface RelayApi {
  keyPackages(userId: string): Promise<{
    keyPackages: Array<{
      deviceId: string;
      packageBase64: string;
      expiresAt: string;
    }>;
  }>;
  send(input: {
    recipientDeviceId: string;
    clientMessageId: string;
    ciphertext: Uint8Array;
    expiresAt: string;
  }): Promise<unknown>;
  receive(): Promise<{
    leaseOwner: string;
    envelopes: Array<{ id: string; ciphertextBase64: string }>;
  }>;
  acknowledge(leaseOwner: string, envelopeIds: string[]): Promise<void>;
}

export class FinalMessagingOrchestrator {
  constructor(
    private readonly core: CryptoCore,
    private readonly relay: RelayApi
  ) {}

  async sendText(input: { recipientUserId: string; plaintext: string }) {
    const runtime = await this.core.runtimeInfo();
    if (!runtime.secureCoreReady) throw new Error("Secure core unavailable.");
    if (!input.plaintext.trim()) throw new Error("Message cannot be empty.");

    const packages = await this.relay.keyPackages(input.recipientUserId);
    const recipient = packages.keyPackages.find(
      (item) => new Date(item.expiresAt).getTime() > Date.now()
    );
    if (!recipient) throw new Error("No valid recipient key package.");

    const messageId = crypto.randomUUID();
    const createdAtUnix = Math.floor(Date.now() / 1000);
    const expiresAtUnix = createdAtUnix + 30 * 24 * 60 * 60;
    const ciphertext = await this.core.encryptMessage({
      recipientUserId: input.recipientUserId,
      recipientDeviceId: recipient.deviceId,
      recipientKeyPackageBase64: recipient.packageBase64,
      messageId,
      plaintext: input.plaintext,
      createdAtUnix,
      expiresAtUnix
    });

    if (ciphertext.byteLength < 32) {
      throw new Error("Core returned invalid ciphertext.");
    }

    await this.relay.send({
      recipientDeviceId: recipient.deviceId,
      clientMessageId: messageId,
      ciphertext,
      expiresAt: new Date(expiresAtUnix * 1000).toISOString()
    });
    return { messageId };
  }

  async receive() {
    const batch = await this.relay.receive();
    const messages: Awaited<ReturnType<CryptoCore["decryptMessage"]>>[] = [];
    const acknowledgedIds: string[] = [];

    for (const envelope of batch.envelopes) {
      try {
        const ciphertext = Uint8Array.from(
          atob(envelope.ciphertextBase64),
          (value) => value.charCodeAt(0)
        );
        messages.push(await this.core.decryptMessage(ciphertext));
        acknowledgedIds.push(envelope.id);
      } catch {
        // Authentication/decryption failures remain leased for retry or review.
      }
    }

    if (acknowledgedIds.length) {
      await this.relay.acknowledge(batch.leaseOwner, acknowledgedIds);
    }
    return messages;
  }
}