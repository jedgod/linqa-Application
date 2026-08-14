import { RawWasmCoreBridge } from "../core/RawWasmCoreBridge";

type RawSession = {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionId: string;
};

const INSTALLATION_KEY = "linqa.installation.id";

function jwtUserId(token: string): string {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("temporary session token is malformed");
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
  const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0))));
  if (typeof parsed.user_id !== "string") throw new Error("temporary session has no user identity");
  return parsed.user_id;
}

async function request<T>(baseUrl: string, path: string, token: string, body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "device enrollment failed");
  return payload as T;
}

export async function enrollBrowserWithRustCore(input: {
  baseUrl: string;
  temporarySession: RawSession;
  deviceName?: string;
}) {
  const userId = jwtUserId(input.temporarySession.accessToken);
  const deviceName = input.deviceName ?? "Linqa Web";
  let installationId = localStorage.getItem(INSTALLATION_KEY);
  if (!installationId) {
    installationId = crypto.randomUUID();
    localStorage.setItem(INSTALLATION_KEY, installationId);
  }
  const core = await RawWasmCoreBridge.load({
    userId,
    deviceId: installationId,
    keyStorageNamespace: installationId
  });

  try {
    const challenge = await request<{
      challengeId: string; userId: string; nonceBase64: string; expiresAt: string;
    }>(input.baseUrl, "/v1/device-enrollment/challenges", input.temporarySession.accessToken);
    const encodedChallenge = btoa(JSON.stringify(challenge));
    const proofBytes = await core.createEnrollmentProof({
      userId,
      deviceId: installationId,
      challengeBase64: encodedChallenge,
      deviceName,
      platform: "WEB"
    });
    const proof = JSON.parse(new TextDecoder().decode(proofBytes)) as {
      challenge_id: string; signing_public_key: number[]; encryption_public_key: number[]; signature: number[];
    };
    const enrolled = await request<{ deviceId: string; status: string; session: RawSession }>(
      input.baseUrl,
      "/v1/device-enrollment/complete",
      input.temporarySession.accessToken,
      {
        challengeId: proof.challenge_id,
        deviceName,
        platform: "WEB",
        signingPublicKeyBase64: bytesBase64(proof.signing_public_key),
        encryptionPublicKeyBase64: bytesBase64(proof.encryption_public_key),
        signatureBase64: bytesBase64(proof.signature)
      }
    );
    core.setEnrolledDeviceId(enrolled.deviceId);
    sessionStorage.setItem("linqa.access.token", enrolled.session.accessToken);
    sessionStorage.setItem("linqa.auth.runtime", JSON.stringify({ authenticated: true, userId, deviceId: enrolled.deviceId }));
    window.dispatchEvent(new Event("linqa:runtime-changed"));
    return { core, userId, deviceId: enrolled.deviceId, session: enrolled.session };
  } catch (error) {
    core.dispose();
    throw error;
  }
}

function bytesBase64(values: number[]): string {
  let binary = "";
  for (const value of values) binary += String.fromCharCode(value);
  return btoa(binary);
}
