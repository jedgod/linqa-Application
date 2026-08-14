import { useState } from "react";
import type { CoreAdapter, SecurityRuntimeState } from "../services/CoreBridge";

interface Props {
  adapter: CoreAdapter;
  state: SecurityRuntimeState;
  conversationId: string;
  onSent?: (clientMessageId: string) => void;
}

/**
 * Reference composer wired directly against `CoreAdapter` (demo-store or
 * real WASM core). Not currently mounted in `App` — the live chat UI
 * (`ChatView`) sends through the mock conversation-data `CoreBridge` object
 * instead, so sent messages appear in the visible thread. This component is
 * the intended replacement once a single adapter backs both the visible
 * thread and the security-runtime state.
 */
export function SafeMessageComposer({
  adapter,
  state,
  conversationId,
  onSent,
}: Props) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const canSend = (state.kind === "ready" || state.kind === "demo") && !sending;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const normalized = body.trim();
    if (!normalized) return;
    if (!canSend) {
      setError("Secure core is unavailable. The message was not sent.");
      return;
    }

    setSending(true);
    const clientMessageId = crypto.randomUUID();

    try {
      const result = await adapter.sendMessage({
        conversationId,
        clientMessageId,
        body: normalized,
      });
      setBody("");
      onSent?.(result.clientMessageId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Message was not sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="message-body">
        Message
      </label>
      <textarea
        id="message-body"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        disabled={!canSend}
        maxLength={10_000}
        placeholder={
          state.kind === "demo"
            ? "Demo message — not encrypted"
            : state.kind === "ready"
              ? "Write an encrypted message"
              : "Secure core unavailable"
        }
      />
      <button type="submit" disabled={!canSend || !body.trim()}>
        {sending ? "Sending…" : state.kind === "demo" ? "Save demo" : "Send"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
