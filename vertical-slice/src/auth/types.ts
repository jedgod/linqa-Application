export interface AuthPrincipal {
  subject: string;
  userId: string;
  deviceId: string;
  scopes: ReadonlySet<string>;
}
