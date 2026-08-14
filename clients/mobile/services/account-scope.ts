type Reset = () => void | Promise<void>;
const resets = new Map<string, Reset>();
const scopedValues = new Map<string, unknown>();
let generation = 0;

export function registerAccountScopeReset(namespace: string, reset: Reset): () => void {
  resets.set(namespace, reset);
  return () => resets.delete(namespace);
}

/** Clears account-bound auth, CountryLinqa, push, vault, chat, and profile state before hydration. */
export function clearAccountScopedState(): void {
  generation += 1;
  scopedValues.clear();
  for (const reset of resets.values()) void Promise.resolve(reset()).catch(() => undefined);
}

export function accountScopeGeneration(): number { return generation; }

export function putAccountScopedValue(namespace: "countrylinqa" | "profile" | "push" | "vault" | "chats" | "presence", value: unknown): void {
  scopedValues.set(namespace, value);
}
export function getAccountScopedValue<T>(namespace: string): T | undefined { return scopedValues.get(namespace) as T | undefined; }
