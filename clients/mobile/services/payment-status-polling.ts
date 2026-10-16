export async function pollPaymentStatus<T>(options: {
  load(): Promise<T>; onValue(value: T): void; onError(error: unknown): void;
  terminal(value: T): boolean; signal: AbortSignal; wait?: (ms: number) => Promise<void>;
}) {
  let failures = 0;
  const wait = options.wait ?? (ms => new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); options.signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    options.signal.addEventListener("abort", done, { once: true });
  }));
  while (!options.signal.aborted) {
    try {
      const value = await options.load();
      if (options.signal.aborted) return;
      options.onValue(value); failures = 0;
      if (options.terminal(value)) return;
    } catch (error) {
      if (options.signal.aborted) return;
      options.onError(error);
      if (++failures >= 5) return;
    }
    await wait(Math.min(30_000, 3000 * 2 ** failures));
  }
}
