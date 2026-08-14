export interface ContactHashCore {
  createDiscoveryToken(input: {
    type: "PHONE" | "EMAIL";
    normalizedValue: string;
  }): Promise<Uint8Array>;
}

export class ContactDiscoveryClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getAccessToken: () => Promise<string>,
    private readonly hashCore: ContactHashCore
  ) {}

  async discover(
    identifiers: Array<{ type: "PHONE" | "EMAIL"; normalizedValue: string }>
  ) {
    const unique = new Map(
      identifiers.map((item) => [`${item.type}:${item.normalizedValue}`, item])
    );

    const tokens = [];
    for (const identifier of [...unique.values()].slice(0, 500)) {
      const token = await this.hashCore.createDiscoveryToken(identifier);
      tokens.push({
        type: identifier.type,
        tokenBase64: this.toBase64(token)
      });
    }

    const accessToken = await this.getAccessToken();
    const response = await fetch(
      `${this.apiBaseUrl}/v1/contact-discovery/query`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ tokens })
      }
    );

    if (!response.ok) throw new Error("Contact discovery failed.");
    return response.json() as Promise<{ userIds: string[] }>;
  }

  private toBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
}
