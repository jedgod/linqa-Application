/**
 * Seams into the rest of the Linqa app. CallCrypto is implemented by
 * crypto/LinqaCallCrypto.ts on top of linqa-core.
 */
import type { KeyEnvelope } from './protocol';

export interface CallCrypto {
  /** New random call key. Returns its id (the key stays on this device). */
  createCallKey(): Promise<string>;
  hasKey(keyId: string): boolean;
  /** Seal the call key to every device of these users. Used to call and to Add person. */
  envelopesFor(keyId: string, userIds: string[]): Promise<KeyEnvelope[]>;
  /** Seal the call key to another of your own devices. Used by Switch device. */
  envelopeForOwnDevice(keyId: string, deviceId: string): Promise<string>;
  /** Open, verify and store a call key someone sealed to this device. Throws if anything is off. */
  acceptEnvelope(keyId: string, fromUserId: string, fromDeviceId: string, envelope: string): Promise<void>;
  encrypt(keyId: string, plaintext: Uint8Array): Promise<string>;
  /** Returns the verified sender. Throws on a bad signature, wrong key or replay. */
  decrypt(keyId: string, ciphertext: string): Promise<{ senderUserId: string; senderDeviceId: string; plaintext: Uint8Array }>;
  /** Short code everyone in the call should see identically. */
  verificationCode(keyId: string): Promise<string | null>;
  /** Wipe the call key. */
  forget(keyId: string): Promise<void>;
}

export interface CallSession {
  apiBaseUrl: string; // e.g. https://api.linqa.app
  getToken(): Promise<string>;
  userId: string;
  deviceId: string;
  deviceName: string;
  platform: 'ios' | 'android' | 'desktop' | 'web';
}

export interface CallerLocation {
  countryCode: string;
  flag: string;
  /** Coarse area only, e.g. GLENN BURNIE, MD. Never a street address. */
  area: string;
}

export interface CallPeopleDirectory {
  displayName(userId: string): string;
  avatarUrl?(userId: string): string | undefined;
  /** Coarse country and area for the video header. Omit if unknown. */
  location?(userId: string): CallerLocation | undefined;
  /** People this user may add to a call (contacts, not blocked). */
  addableContacts(query: string): Promise<{ userId: string; name: string }[]>;
  /** Your existing block action. Offered at the end of Report. */
  block?(userId: string): Promise<void>;
}
