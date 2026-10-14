// The scheduler's server calls. The base URL is empty in the browser (Vite proxies /calls to the mock
// server) and can be set with VITE_API_BASE.
const BASE = import.meta.env?.VITE_API_BASE ?? "";

export const JOIN_LOCK_MS = 10000;
const locks = new Map();

export async function fetchScheduledCalls() {
  const response = await fetch(`${BASE}/calls/scheduled`);
  if (!response.ok) throw new Error("Failed to fetch scheduled calls");
  return response.json();
}

/**
 * Joins a call. A call joined in the last JOIN_LOCK_MS can't be joined again, whichever button asks,
 * so the same call never rings twice. Resolves { success, skipped?, error? }; a failed join frees the lock.
 */
export async function joinCall(callId, now = Date.now()) {
  if ((locks.get(callId) ?? 0) > now) return { success: false, skipped: true, error: "Already connecting." };
  locks.set(callId, now + JOIN_LOCK_MS);
  try {
    const response = await fetch(`${BASE}/calls/${encodeURIComponent(callId)}/join`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      locks.delete(callId);
      return { success: false, error: data.error === "NOT_JOINABLE" ? "This call isn't open yet." : "Unable to join call at this time." };
    }
    return data;
  } catch {
    locks.delete(callId);
    return { success: false, error: "Could not reach the server." };
  }
}

export const clearJoinLocks = () => locks.clear();
