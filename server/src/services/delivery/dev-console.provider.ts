import type { AppConfig } from "../../config.js";
import type { DeliveryProvider } from "../auth-challenge.service.js";

/**
 * Development-only delivery provider. No SMS/email provider is configured
 * for this pack (see APPLY_GUIDE.txt item 4) — this exists purely so the
 * OTP flow is exercisable locally.
 *
 * It refuses to run outside development/test, and it is the ONLY place in
 * the codebase allowed to log an OTP code — production delivery providers
 * (real SMS/email adapters) must never log codes.
 */
export class DevConsoleDeliveryProvider implements DeliveryProvider {
  constructor(config: AppConfig) {
    if (config.NODE_ENV === "production") {
      throw new Error(
        "DevConsoleDeliveryProvider must not be used in production; configure a real SMS/email provider."
      );
    }
  }

  async sendSms(phone: string, code: string): Promise<void> {
    console.log(`[dev-delivery] SMS OTP for ${phone}: ${code} (DEV ONLY — never logged in production)`);
  }

  async sendEmail(email: string, code: string): Promise<void> {
    console.log(`[dev-delivery] Email OTP for ${email}: ${code} (DEV ONLY — never logged in production)`);
  }
}
