export type CountryLinqaFlags={
  discoveryEnabled:boolean;
  peopleEnabled:boolean;
  recommendationsEnabled:boolean;
  savedSearchAlertsEnabled:boolean;
  worldwideEnabled:boolean;
  advancedRankingEnabled:boolean;
  redisCacheEnabled:boolean;
  rolloutPercent:number;
};

export function userBucket(userId:string) {
  let h=2166136261;
  for (const c of userId) h=Math.imul(h^c.charCodeAt(0),16777619);
  return (h>>>0)%100;
}

export function enabledForUser(flag:boolean,rolloutPercent:number,userId:string) {
  return flag && userBucket(userId)<Math.max(0,Math.min(100,rolloutPercent));
}
