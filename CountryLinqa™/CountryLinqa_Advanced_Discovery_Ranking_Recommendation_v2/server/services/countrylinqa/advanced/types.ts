export type DiscoveryFilters = {
  query?: string;
  countries?: string[];
  region?: string;
  languages?: string[];
  interests?: string[];
  profession?: string;
  verifiedOnly?: boolean;
  onlineOnly?: boolean;
};

export type RankCandidate = {
  userId: string;
  countryCode: string;
  verified: boolean;
  languages: string[];
  interests: string[];
  professionCode: string | null;
  lastActiveAt: string | null;
  mutualConnections: number;
  profileQuality: number;
  safetyQuality: number;
  freshness: number;
};

export type ViewerFeatures = {
  userId: string;
  countryCode: string;
  languages: string[];
  interests: string[];
  professionCode: string | null;
};

export type RankedCandidate = RankCandidate & {
  score: number;
  reasons: string[];
};
