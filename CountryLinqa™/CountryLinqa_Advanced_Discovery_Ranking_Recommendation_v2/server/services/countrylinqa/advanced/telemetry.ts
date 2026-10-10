export type DiscoveryTelemetry = {
  event:
    | "DISCOVERY_QUERY"
    | "DISCOVERY_PAGE"
    | "DISCOVERY_IMPRESSION"
    | "DISCOVERY_PROFILE_OPEN"
    | "SAVED_SEARCH_CREATED";
  userId:string;
  surface:string;
  discoveryMode:string;
  resultCount?:number;
  latencyMs?:number;
  experimentKey?:string;
};

// Never emit:
// - precise coordinates
// - raw phone numbers
// - raw search text
// - recovery identifiers
// - private profile fields

export function telemetryPayload(x:DiscoveryTelemetry) {
  return {
    ...x,
    emittedAt:new Date().toISOString()
  };
}
