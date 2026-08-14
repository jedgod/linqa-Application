/** Adapted from the GA Hardening pack's GaHardeningClient.ts — see milestone3.service.ts for why. */
export class GaHardeningService {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getAccessToken: () => Promise<string>
  ) {}

  private async request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        ...(init?.body !== undefined ? { "content-type": "application/json" } : {})
      },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {})
    });

    if (!response.ok) {
      throw new Error(`GA hardening request failed (${response.status}).`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  readiness() {
    return this.request<{
      ready: boolean;
      blockingGates: any[];
      unresolvedCriticalFindings: number;
    }>("/v4/ga/readiness");
  }

  createPrivacyRequest(input: {
    type: "ACCESS" | "PORTABILITY" | "DELETE" | "CORRECT" | "OPT_OUT_SALE" | "OPT_OUT_SHARING" | "LIMIT_SENSITIVE_USE";
    jurisdiction: string;
  }) {
    return this.request("/v4/privacy/requests", { method: "POST", body: input });
  }

  createSupportCase(input: { category: string; priority: "LOW" | "NORMAL" | "HIGH" | "URGENT"; subject: string; description: string }) {
    return this.request("/v4/support/cases", { method: "POST", body: input });
  }

  residency() {
    return this.request("/v4/residency");
  }
}
