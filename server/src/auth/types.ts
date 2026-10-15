export interface AuthPrincipal {
  subject: string;
  userId: string;
  deviceId?: string;
  sessionId?: string;
  expiresAt?: number;
  scopes: ReadonlySet<string>;
}
