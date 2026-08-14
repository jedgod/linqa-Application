import type { RelayClient } from "./RelayClient";

export interface CryptoCore {
  getRuntimeState(): Promise<{
    ready: boolean;
    encrypted: boolean;
    protocolVersion?: string;
  }>;
  encryptMessage(input: {
    recipientUserId: string;
    recipientDeviceId: string;
    recipientEncryptionPublicKeyBase64: string;
    plaintextUtf8: string;
    messageId: string;
    createdAtUnix: number;
    expiresAtUnix: number;
  }): Promise<Uint8Array>;
  decryptMessage(envelope: Uint8Array): Promise<{
    messageId: string;
    senderUserId: string;
    senderDeviceId: string;
    plaintextUtf8: string;
  }>;
}

export class SecureMessagingService {
  constructor(
    private readonly core: CryptoCore,
    private readonly relay: RelayClient
  ) {}

  async send(input: {
    recipientUserId: string;
    recipientDeviceId: string;
    recipientEncryptionPublicKeyBase64: string;
    plaintext: string;
  }) {
    const state = await this.core.getRuntimeState();
    if (!state.ready || !state.encrypted) {
      throw new Error("Secure cryptographic core is unavailable.");
    }

    const plaintext = input.plaintext.trim();
    if (!plaintext) throw new Error("Message cannot be empty.");

    const messageId = crypto.randomUUID();
    const createdAtUnix = Math.floor(Date.now() / 1000);
    const expiresAtUnix = createdAtUnix + 30 * 24 * 60 * 60;

    const ciphertext = await this.core.encryptMessage({
      recipientUserId: input.recipientUserId,
      recipientDeviceId: input.recipientDeviceId,
      recipientEncryptionPublicKeyBase64:
        input.recipientEncryptionPublicKeyBase64,
      plaintextUtf8: plaintext,
      messageId,
      createdAtUnix,
      expiresAtUnix
    });

    if (ciphertext.byteLength < 32) {
      throw new Error("Cryptographic core returned an invalid envelope.");
    }

    return this.relay.submitEnvelope({
      recipientDeviceId: input.recipientDeviceId,
      clientMessageId: messageId,
      ciphertext,
      expiresAt: new Date(expiresAtUnix * 1000).toISOString()
    });
  }

  async receiveAndAcknowledge() {
    const batch = await this.relay.receive(100);
    const decrypted = [];
    const acceptedIds: string[] = [];

    for (const envelope of batch.envelopes) {
      try {
        const bytes = Uint8Array.from(
          atob(envelope.ciphertextBase64),
          (character) => character.charCodeAt(0)
        );
        decrypted.push(await this.core.decryptMessage(bytes));
        acceptedIds.push(envelope.id);
      } catch {
        // Do not acknowledge envelopes that fail authentication/decryption.
      }
    }

    if (acceptedIds.length > 0) {
      await this.relay.acknowledge(batch.leaseOwner, acceptedIds);
    }

    return decrypted;
  }
}
