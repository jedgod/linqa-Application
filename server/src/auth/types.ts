export interface AuthPrincipal {
  subject: string;
  userId: string;
  deviceId?: string;
  sessionId?: string;
  scopes: ReadonlySet<string>;
}
