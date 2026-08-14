export class CommunityClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getAccessToken: () => Promise<string>
  ) {}

  async create(input: {
    name: string;
    visibility: "PRIVATE" | "INVITE_ONLY" | "PUBLIC";
  }) {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.apiBaseUrl}/v1/communities`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify(input)
    });

    if (!response.ok) throw new Error("Community creation failed.");
    return response.json();
  }
}
