import { useState } from "react";
import type { AuthClient, IdentifierPurpose } from "../services/AuthClient";

export function usePasswordlessAuth(client: AuthClient) {
  const [loading, setLoading] = useState(false);
  const [challengeRequested, setChallengeRequested] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function request(identifier: string, purpose: IdentifierPurpose) {
    setLoading(true);
    setError(null);
    try {
      const challenge = await client.requestCode(identifier, purpose);
      setChallengeId(challenge.challengeId);
      setChallengeRequested(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  async function verify(code: string) {
    if (!challengeId) {
      throw new Error("No pending verification challenge.");
    }
    setLoading(true);
    setError(null);
    try {
      return await client.verifyCode(challengeId, code);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verification failed.");
      throw cause;
    } finally {
      setLoading(false);
    }
  }

  return {
    loading,
    challengeRequested,
    challengeId,
    error,
    request,
    verify
  };
}
