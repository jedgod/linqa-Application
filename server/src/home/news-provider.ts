import type { NewsQuery, RawNewsArticle } from "./home.types.js";

export interface NewsProvider {
  readonly name: string;
  readonly priority: number;
  isConfigured(): boolean;
  fetch(query: NewsQuery, signal: AbortSignal): Promise<RawNewsArticle[]>;
}
