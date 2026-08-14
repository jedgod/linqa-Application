export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

/** In-process cache, matching the pack. Redis is future work, not blocking
 * for a single-instance dev server. */
export class MemoryCache implements Cache {
  private readonly store = new Map<string, { expires: number; value: unknown }>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expires < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.set(key, { expires: Date.now() + ttlSeconds * 1000, value });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}
