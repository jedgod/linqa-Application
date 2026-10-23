/**
 * One place that talks to Google's Gemini API (the free-tier key in GEMINI_API_KEY), shared by Linqa AI and Wallet support chat.
 * Only the status of a failed call is ever logged: the provider's error text can echo parts of the request.
 */
export type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } };
export type GeminiContent = { role: string; parts: GeminiPart[] };

export type GeminiResult =
  | { kind: "ok"; text: string; model: string }
  | { kind: "empty"; model: string }
  | { kind: "busy" }
  | { kind: "unavailable" };

type Log = { warn: (details: object, message: string) => void };

/**
 * Asks the first model; if it is slow, busy or erroring, the next (lighter) one answers instead of making the person wait or fail.
 * `fetchImpl` exists so tests can run without the network.
 */
export async function askGemini(input: {
  apiKey: string; models: string[]; system: string; contents: GeminiContent[]; log: Log;
  temperature?: number; maxOutputTokens?: number; timeoutsMs?: [number, number]; fetchImpl?: typeof fetch;
}): Promise<GeminiResult> {
  const call = input.fetchImpl ?? fetch;
  const timeouts = input.timeoutsMs ?? [20_000, 30_000];
  let response: Response | null = null;
  let model = input.models[0]!;
  for (const [index, candidate] of input.models.entries()) {
    model = candidate;
    try {
      response = await call(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidate)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": input.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents: input.contents,
          generationConfig: { temperature: input.temperature ?? 0.4, maxOutputTokens: input.maxOutputTokens ?? 2048 }
        }),
        signal: AbortSignal.timeout(index === 0 ? timeouts[0] : timeouts[1])
      });
      if (response.ok || (response.status !== 429 && response.status < 500 && response.status !== 404)) break;
      input.log.warn({ status: response.status, model: candidate }, "ai model unavailable, trying the next");
    } catch (error) {
      input.log.warn({ err: error, model: candidate }, "ai model did not answer in time");
      response = null;
    }
  }
  if (!response) return { kind: "unavailable" };
  if (response.status === 429) return { kind: "busy" };
  if (!response.ok) {
    input.log.warn({ status: response.status }, "ai provider refused the request");
    return { kind: "unavailable" };
  }
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.filter((part) => !part.thought).map((part) => part.text ?? "").join("").trim();
  return text ? { kind: "ok", text, model } : { kind: "empty", model };
}

export const defaultModels = (primary: string | undefined) => [primary ?? "gemini-3.5-flash", "gemini-3.5-flash-lite"];
