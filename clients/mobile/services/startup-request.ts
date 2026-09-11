/** Bound startup requests so a disconnected device can offer a retry. */
export async function startupRequest(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    throw new Error("Linqa could not connect. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
}
