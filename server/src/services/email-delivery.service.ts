import type { AppConfig } from "../config.js";
import type { DeliveryProvider } from "./auth-challenge.service.js";
import type { OtpDeliveryProvider } from "./mobile-otp.service.js";

export interface RecoveryEmailDelivery {
  sendVerification(input: { destination: string; code: string }): Promise<void>;
}

export class FailClosedEmailDelivery implements RecoveryEmailDelivery {
  async sendVerification(): Promise<never> {
    throw new Error("transactional email provider is not configured");
  }
}

export class DevConsoleEmailDelivery implements RecoveryEmailDelivery {
  constructor(config: Pick<AppConfig, "NODE_ENV">) {
    if (config.NODE_ENV === "production") {
      throw new Error("development email delivery cannot run in production");
    }
  }

  async sendVerification(input: { destination: string; code: string }): Promise<void> {
    console.log(`[dev-delivery] Recovery email OTP for ${input.destination}: ${input.code} (DEV ONLY)`);
  }
}

/**
 * Provider-neutral HTTPS adapter. The configured endpoint receives a minimal
 * JSON contract and authenticates with a bearer token. This keeps provider SDKs
 * out of the identity boundary and makes the transport contract-testable.
 */
export class HttpTransactionalEmailDelivery implements RecoveryEmailDelivery {
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
    private readonly from: string,
    private readonly healthEndpoint: string
  ) {}

  async health(): Promise<void> {
    const response = await fetch(this.healthEndpoint, { method: "HEAD", headers: { authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(3_000) });
    if (!response.ok) throw new Error(`transactional email health failed (${response.status})`);
  }

  async sendVerification(input: { destination: string; code: string }): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: this.from,
        to: input.destination,
        template: "linqa-verification-code",
        variables: { code: input.code, expiresInMinutes: 10 }
      })
    });
    if (!response.ok) throw new Error(`transactional email delivery failed (${response.status})`);
  }
}

/** Bridges the general auth contract to the independently configured SMS and email transports. */
export class CompositeAuthDelivery implements DeliveryProvider {
  constructor(
    private readonly sms: OtpDeliveryProvider,
    private readonly email: RecoveryEmailDelivery
  ) {}

  sendSms(phone: string, code: string): Promise<void> {
    return this.sms.sendSms({ destination: phone, code });
  }

  sendEmail(email: string, code: string): Promise<void> {
    return this.email.sendVerification({ destination: email, code });
  }
}
