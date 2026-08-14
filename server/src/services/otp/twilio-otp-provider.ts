import type { OtpDeliveryProvider } from "../mobile-otp.service.js";

/** Real implementation of OtpDeliveryProvider (2026-08-07) using the Twilio REST API (no SDK dependency — plain fetch + HTTP Basic auth). */
export class TwilioOtpProvider implements OtpDeliveryProvider {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly fromNumber: string,
    private readonly voiceFromNumber?: string
  ) {}

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`;
  }

  async health(): Promise<void> {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}.json`, { headers: { authorization: this.authHeader() }, signal: AbortSignal.timeout(3_000) });
    if (!response.ok) throw new Error(`Twilio health failed (${response.status}).`);
  }

  async sendSms(input: { destination: string; code: string }): Promise<void> {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: this.authHeader(),
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        To: input.destination,
        From: this.fromNumber,
        Body: `Your Linqa verification code is ${input.code}. It expires in 5 minutes.`
      })
    });

    if (!response.ok) {
      throw new Error(`Twilio SMS delivery failed (${response.status}).`);
    }
  }

  async sendVoice(input: { destination: string; code: string }): Promise<void> {
    const from = this.voiceFromNumber ?? this.fromNumber;
    const spokenCode = input.code.split("").join(", ");
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Your Linqa verification code is ${spokenCode}. Again, your code is ${spokenCode}.</Say></Response>`;

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Calls.json`, {
      method: "POST",
      headers: {
        authorization: this.authHeader(),
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        To: input.destination,
        From: from,
        Twiml: twiml
      })
    });

    if (!response.ok) {
      throw new Error(`Twilio voice delivery failed (${response.status}).`);
    }
  }
}
