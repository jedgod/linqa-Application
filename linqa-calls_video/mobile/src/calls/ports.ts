/**
 * Seams into the rest of the Linqa app. Implement these with your existing
 * MLS client, auth and contacts code, then pass them to CallManager.
 */

export interface CallCrypto {
  /**
   * Create an MLS group just for this call with the given users' devices,
   * send Welcomes through your existing delivery service, return its id.
   */
  createCallGroup(memberUserIds: string[]): Promise<string>;
  /** Add users (all their devices) to the call group. Used by Add person. */
  addUsers(groupId: string, userIds: string[]): Promise<void>;
  /** Add one of your own devices. Used by Switch device. */
  addOwnDevice(groupId: string, deviceId: string): Promise<void>;
  /** Resolve once this device has processed the Welcome for the group. */
  waitForGroup(groupId: string, timeoutMs: number): Promise<void>;
  encrypt(groupId: string, plaintext: Uint8Array): Promise<string>;
  /** Must return the authenticated MLS sender of the message. */
  decrypt(groupId: string, ciphertext: string): Promise<{ senderUserId: string; senderDeviceId: string; plaintext: Uint8Array }>;
  /**
   * Short code derived from the MLS epoch authenticator. Everyone in the call
   * sees the same code; comparing it out loud proves no one is in the middle.
   */
  verificationCode(groupId: string): Promise<string | null>;
  leaveGroup(groupId: string): Promise<void>;
}

export interface CallSession {
  apiBaseUrl: string; // e.g. https://api.linqa.app
  getToken(): Promise<string>;
  userId: string;
  deviceId: string;
}

export interface CallerLocation {
  /** ISO country code, e.g. US. */
  countryCode: string;
  /** Emoji flag, e.g. 🇺🇸. */
  flag: string;
  /** Coarse area only, e.g. GLENN BURNIE, MD. Never a street address. */
  area: string;
}

export interface CallPeopleDirectory {
  displayName(userId: string): string;
  avatarUrl?(userId: string): string | undefined;
  /** Coarse country and area for the call header. Omit if unknown. */
  location?(userId: string): CallerLocation | undefined;
  /** People this user may add to a call (contacts, not blocked). */
  addableContacts(query: string): Promise<{ userId: string; name: string }[]>;
  /** Your existing block action. Offered at the end of Report. */
  block?(userId: string): Promise<void>;
}
