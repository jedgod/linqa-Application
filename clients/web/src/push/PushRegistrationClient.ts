export class PushRegistrationClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getAccessToken: () => Promise<string>
  ) {}

  async registerWebPush(input: {
    endpoint: string;
    p256dh: string;
    auth: string;
    appBundle: string;
  }) {
    const token = await this.getAccessToken();
    const encoded = btoa(JSON.stringify(input));

    const response = await fetch(
      `${this.apiBaseUrl}/v1/push/endpoints/current`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          provider: "WEB_PUSH",
          token: encoded,
          appBundle: input.appBundle,
          environment: "PRODUCTION"
        })
      }
    );

    if (!response.ok) {
      throw new Error("Push registration failed.");
    }
  }
}
