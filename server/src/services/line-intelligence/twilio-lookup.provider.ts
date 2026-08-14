import type { MobileLineIntelligenceProvider, MobileLineType } from "../mobile-line-intelligence.service.js";

/**
 * Twilio Lookup v2 line_type_intelligence -> Linqa MobileLineType. Only
 * signals Twilio actually returns are populated; anything this package
 * doesn't report (SIM-swap risk, porting, a numeric fraud score — those are
 * separate Twilio products not enabled here) is left undefined rather than
 * fabricated, so PhoneRiskService weighs only real evidence.
 */
const TWILIO_TYPE_MAP: Record<string, MobileLineType> = {
  mobile: "MOBILE",
  nonFixedVoip: "VOIP",
  fixedVoip: "FIXED_VOIP",
  tollFree: "TOLL_FREE",
  premium: "PREMIUM_RATE",
  pager: "PAGER"
  // landline, personal, sharedCost, uan, voicemail intentionally omitted:
  // none of Linqa's ALLOWED set fits them, and none is confidently a
  // REJECTED category either (e.g. a landline is ineligible but not
  // "invalid" or "VoIP") — they fall through to UNKNOWN below, which
  // PhoneRiskService routes to REVIEW_REQUIRED rather than a false claim.
};

export class TwilioLookupProvider implements MobileLineIntelligenceProvider {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string
  ) {}

  async lookup(e164: string): ReturnType<MobileLineIntelligenceProvider["lookup"]> {
    const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}?Fields=line_type_intelligence`;
    const response = await fetch(url, {
      headers: {
        authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`
      }
    });

    if (!response.ok) {
      throw new Error(`Twilio Lookup request failed (${response.status}).`);
    }

    const body = (await response.json()) as {
      valid: boolean;
      phone_number: string;
      country_code?: string;
      line_type_intelligence?: {
        type?: string | null;
        carrier_name?: string | null;
        mobile_country_code?: string | null;
        mobile_network_code?: string | null;
        error_code?: number | null;
      } | null;
    };

    const twilioType = body.line_type_intelligence?.type ?? undefined;
    const lineType: MobileLineType = twilioType ? (TWILIO_TYPE_MAP[twilioType] ?? "UNKNOWN") : "UNKNOWN";
    const isVoip = lineType === "VOIP" || lineType === "FIXED_VOIP";

    return {
      providerReference: body.phone_number,
      valid: body.valid === true,
      lineType,
      ...(body.line_type_intelligence?.carrier_name ? { carrierName: body.line_type_intelligence.carrier_name } : {}),
      ...(body.country_code ? { countryIso2: body.country_code } : {}),
      ...(body.line_type_intelligence?.mobile_country_code
        ? { mobileCountryCode: body.line_type_intelligence.mobile_country_code }
        : {}),
      ...(body.line_type_intelligence?.mobile_network_code
        ? { mobileNetworkCode: body.line_type_intelligence.mobile_network_code }
        : {}),
      voip: isVoip
    };
  }
}
