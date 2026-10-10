export type DiscoveryMode =
  | "MY_COUNTRY"
  | "SELECTED_COUNTRIES"
  | "REGION"
  | "GLOBAL";

export type InboundMode =
  | DiscoveryMode
  | "CONTACTS_ONLY";

export interface EffectiveDiscoveryPolicy {
  viewerUserId: string;
  viewerCountryCode: string;
  outboundMode: DiscoveryMode;
  outboundCountryCodes: string[];
  outboundRegionCode: string | null;
  inboundMode: InboundMode;
  inboundCountryCodes: string[];
  inboundRegionCode: string | null;
  verifiedOnly: boolean;
  discoveryPaused: boolean;
  allowBusinesses: boolean;
  allowCommunities: boolean;
  allowEvents: boolean;
}

export type DiscoverySurface =
  | "PEOPLE"
  | "POSTS"
  | "EVENTS"
  | "BUSINESSES"
  | "COMMUNITIES"
  | "SEARCH";
