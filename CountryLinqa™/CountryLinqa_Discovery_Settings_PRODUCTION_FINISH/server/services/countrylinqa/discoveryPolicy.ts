export type Plan = "FREE" | "PREMIUM" | "ELITE";
export type Mode = "MY_COUNTRY" | "SELECTED_COUNTRIES" | "REGION" | "GLOBAL";
export type InboundMode = Mode | "CONTACTS_ONLY";

export interface DiscoveryPolicyInput {
  outboundMode: Mode;
  inboundMode: InboundMode;
  outboundCountryCodes: string[];
  inboundCountryCodes: string[];
  outboundRegionCode?: string | null;
  inboundRegionCode?: string | null;
  showCountry: boolean;
  showState: boolean;
  showCity: boolean;
  verifiedOnly: boolean;
  allowBusinesses: boolean;
  allowCommunities: boolean;
  allowEvents: boolean;
  discoveryPaused: boolean;
  version: number;
}

const COUNTRY = /^[A-Z]{2}$/;
const REGIONS = new Set([
  "NA","EU","AF-W","AF-E","AF-C","AF-S","ME","CAR","APAC","SA"
]);

export function validatePolicy(input: DiscoveryPolicyInput, plan: Plan) {
  const clean = (xs:string[]) => [...new Set(xs.map(x=>x.trim().toUpperCase()))];

  input.outboundCountryCodes = clean(input.outboundCountryCodes);
  input.inboundCountryCodes = clean(input.inboundCountryCodes);

  for (const code of [...input.outboundCountryCodes, ...input.inboundCountryCodes]) {
    if (!COUNTRY.test(code)) throw Object.assign(new Error("INVALID_COUNTRY_CODE"), {status:422});
  }

  if (input.outboundRegionCode && !REGIONS.has(input.outboundRegionCode))
    throw Object.assign(new Error("INVALID_OUTBOUND_REGION"), {status:422});

  if (input.inboundRegionCode && !REGIONS.has(input.inboundRegionCode))
    throw Object.assign(new Error("INVALID_INBOUND_REGION"), {status:422});

  const max = plan === "FREE" ? 1 : plan === "PREMIUM" ? 20 : 250;

  if (input.outboundMode === "SELECTED_COUNTRIES" && input.outboundCountryCodes.length > max)
    throw Object.assign(new Error("OUTBOUND_COUNTRY_LIMIT_EXCEEDED"), {status:403});

  if (input.inboundMode === "SELECTED_COUNTRIES" && input.inboundCountryCodes.length > max)
    throw Object.assign(new Error("INBOUND_COUNTRY_LIMIT_EXCEEDED"), {status:403});

  if ((input.outboundMode === "REGION" || input.inboundMode === "REGION") && plan === "FREE")
    throw Object.assign(new Error("PREMIUM_REQUIRED"), {status:403});

  if ((input.outboundMode === "GLOBAL" || input.inboundMode === "GLOBAL") && plan !== "ELITE")
    throw Object.assign(new Error("ELITE_REQUIRED"), {status:403});

  // City visibility never changes the verified identity country.
  return input;
}
