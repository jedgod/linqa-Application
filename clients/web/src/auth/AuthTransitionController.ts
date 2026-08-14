export interface AuthSession {
  authenticated: boolean;
  userId?: string;
  deviceId?: string;
  accessToken?: string;
}

export class AuthTransitionController {
  setDemoIdentity(): void {
    sessionStorage.setItem(
      "linqa.auth.runtime",
      JSON.stringify({
        authenticated: false,
        mode: "DEMO"
      })
    );
    window.dispatchEvent(new Event("linqa:runtime-changed"));
  }

  setAuthenticatedSession(session: AuthSession): void {
    if (!session.authenticated || !session.userId || !session.deviceId) {
      throw new Error("Authenticated session is incomplete.");
    }

    sessionStorage.setItem(
      "linqa.auth.runtime",
      JSON.stringify({
        authenticated: true,
        userId: session.userId,
        deviceId: session.deviceId
      })
    );

    if (session.accessToken) {
      sessionStorage.setItem("linqa.access.token", session.accessToken);
    }

    window.dispatchEvent(new Event("linqa:runtime-changed"));
  }

  clear(): void {
    sessionStorage.removeItem("linqa.auth.runtime");
    sessionStorage.removeItem("linqa.access.token");
    window.dispatchEvent(new Event("linqa:runtime-changed"));
  }
}
