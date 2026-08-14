export interface ProtocolFixture {
  messageIdFill: number;
  recipientDeviceHashFill: number;
  sentAtUnix: number;
  expiresAtUnix: number;
  replayNonceFill: number;
  aeadNonceFill: number;
  ephemeralX25519PublicFill: number;
  mlKemCiphertextFill: number;
  mlKemCiphertextLength: number;
  senderCredentialFill: number;
  senderCredentialLength: number;
  encryptedPayloadFill: number;
  encryptedPayloadLength: number;
  senderSignatureFill: number;
  encodedLength: number;
  sha256: string;
}

export function encodeProtocolFixture(fixture: ProtocolFixture): Uint8Array {
  const bytes: number[] = [];
  const appendFill = (value: number, length: number) => {
    bytes.push(...new Uint8Array(length).fill(value));
  };
  const appendU16 = (value: number) => {
    bytes.push((value >>> 8) & 0xff, value & 0xff);
  };
  const appendU64 = (value: number) => {
    const encoded = new Uint8Array(8);
    new DataView(encoded.buffer).setBigUint64(0, BigInt(value), false);
    bytes.push(...encoded);
  };
  const appendVector = (value: number, length: number) => {
    appendU64(length);
    appendFill(value, length);
  };

  bytes.push(...new TextEncoder().encode("LQEV"));
  appendU16(1);
  appendFill(fixture.messageIdFill, 16);
  appendFill(fixture.recipientDeviceHashFill, 32);
  appendU64(fixture.sentAtUnix);
  appendU64(fixture.expiresAtUnix);
  appendFill(fixture.replayNonceFill, 32);
  appendFill(fixture.aeadNonceFill, 12);
  bytes.push(...new TextEncoder().encode("LQHK"));
  appendU16(1);
  appendFill(fixture.ephemeralX25519PublicFill, 32);
  appendVector(fixture.mlKemCiphertextFill, fixture.mlKemCiphertextLength);
  appendVector(fixture.senderCredentialFill, fixture.senderCredentialLength);
  appendVector(fixture.encryptedPayloadFill, fixture.encryptedPayloadLength);
  appendFill(fixture.senderSignatureFill, 64);
  return Uint8Array.from(bytes);
}