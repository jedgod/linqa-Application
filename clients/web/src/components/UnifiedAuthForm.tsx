import { useState } from "react";
import type { AuthClient } from "../services/AuthClient";
import { usePasswordlessAuth } from "../hooks/usePasswordlessAuth";
import { validateIdentifierInput, validateOtpInput } from "../auth/validation";

export function UnifiedAuthForm({ client }: { client: AuthClient }) {
  const auth = usePasswordlessAuth(client);
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [identifierError, setIdentifierError] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    const validation = validateIdentifierInput(identifier);
    if (!validation.ok) {
      setIdentifierError(validation.error);
      return;
    }
    setIdentifierError(null);
    await auth.request(validation.normalized, "REGISTRATION");
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    const validation = validateOtpInput(code);
    if (!validation.ok) {
      setOtpError(validation.error);
      return;
    }
    setOtpError(null);
    try {
      let result = await auth.verify(validation.normalized);
      if (result?.registrationRequired) result = await client.registerVerifiedPhone(auth.challengeId!);
      if (!result?.temporarySession) throw new Error("Verified phone session was not issued.");
      await client.enrollSecureDevice(result.temporarySession);
      setComplete(true);
    } catch (cause) {
      setOtpError(cause instanceof Error ? cause.message : "Verification failed.");
      throw cause;
    }
  }

  if (complete) return <div className="auth-card" role="status">Secure device enrolled. Linqa is ready.</div>;

  if (!auth.challengeRequested) {
    return (
      <form onSubmit={requestCode} className="auth-card">
        <h1>Sign in to Linqa</h1>
        <label htmlFor="identifier">Phone number or email</label>
        <input
          id="identifier"
          type="text"
          autoComplete="username"
          value={identifier}
          onChange={(event) => {
            setIdentifier(event.target.value);
            if (identifierError) setIdentifierError(null);
          }}
          placeholder="+1 240 555 0198 or name@example.com"
          required
        />
        <button type="submit" disabled={auth.loading || !identifier.trim()}>
          {auth.loading ? "Sending…" : "Continue"}
        </button>
        {identifierError ? <p role="alert">{identifierError}</p> : null}
        {auth.error ? <p role="alert">{auth.error}</p> : null}
      </form>
    );
  }

  return (
    <form onSubmit={verifyCode} className="auth-card">
      <h1>Enter verification code</h1>
      <p>We sent a code to {identifier}.</p>
      <label htmlFor="otp">Six-digit code</label>
      <input
        id="otp"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        value={code}
        onChange={(event) => {
          const next = event.target.value.replace(/\D/g, "");
          setCode(next);
          if (otpError) setOtpError(null);
        }}
        required
        autoFocus
      />
      <button type="submit" disabled={auth.loading || code.length !== 6}>
        {auth.loading ? "Verifying…" : "Verify"}
      </button>
      {otpError ? <p role="alert">{otpError}</p> : null}
      {auth.error ? <p role="alert">{auth.error}</p> : null}
    </form>
  );
}
