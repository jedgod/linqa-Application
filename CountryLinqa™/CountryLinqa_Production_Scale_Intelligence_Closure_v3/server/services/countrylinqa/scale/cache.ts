import crypto from "node:crypto";

export function cacheKey(x:{
  userId:string; policyVersion:number; featureVersion:number;
  surface:string; filters:unknown; cursor?:string|null;
}) {
  const digest=crypto.createHash("sha256")
    .update(JSON.stringify({f:x.filters,c:x.cursor ?? null}))
    .digest("hex").slice(0,24);
  return `clq:v3:${x.userId}:p${x.policyVersion}:f${x.featureVersion}:${x.surface}:${digest}`;
}

export const TTL={
  PEOPLE:45,
  FEED:60,
  EVENTS:120,
  BUSINESSES:180,
  COMMUNITIES:180,
  SAVED_SEARCH:120
} as const;

// Versioned keys eliminate synchronous wildcard invalidation from the hot path.
// Policy/profile feature changes increment versions. Old entries expire naturally.
