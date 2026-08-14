export class BusinessProfileClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getAccessToken: () => Promise<string>
  ) {}

  async save(input: {
    organizationId?: string;
    displayName: string;
    category: string;
    description?: string;
    website?: string;
    supportHours?: Record<string, unknown>;
  }) {
    const token = await this.getAccessToken();
    const response = await fetch(
      `${this.apiBaseUrl}/v1/business/profile`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify(input)
      }
    );

    if (!response.ok) throw new Error("Business profile update failed.");
    return response.json();
  }
}
