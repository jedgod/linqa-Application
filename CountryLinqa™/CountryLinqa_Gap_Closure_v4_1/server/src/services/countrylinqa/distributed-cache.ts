import crypto from "node:crypto";

export interface CountryLinqaRedis {
  get(key:string):Promise<string|null>;
  set(key:string,value:string,...args:any[]):Promise<unknown>;
  del(...keys:string[]):Promise<unknown>;
}

export type CacheEnvelope<T>={
  policyVersion:number;
  generatedAt:string;
  value:T;
};

const stable=(x:unknown)=>JSON.stringify(x,Object.keys((x ?? {}) as any).sort());

export function discoveryCacheKey(input:{
  userId:string;
  policyVersion:number;
  surface:string;
  filters:unknown;
  cursor?:string|null;
}){
  const digest=crypto.createHash("sha256")
    .update(stable({filters:input.filters,cursor:input.cursor ?? null}))
    .digest("hex").slice(0,24);
  return `countrylinqa:v4:${input.userId}:p${input.policyVersion}:${input.surface}:${digest}`;
}

export class CountryLinqaDistributedCache {
  constructor(
    private redis:CountryLinqaRedis|null,
    private ttlSeconds=45
  ){}

  async get<T>(key:string,policyVersion:number):Promise<T|null>{
    if(!this.redis) return null; // fail open for performance, never for authorization
    const raw=await this.redis.get(key);
    if(!raw) return null;
    try{
      const env=JSON.parse(raw) as CacheEnvelope<T>;
      if(env.policyVersion!==policyVersion) return null;
      return env.value;
    }catch{
      return null;
    }
  }

  async set<T>(key:string,policyVersion:number,value:T){
    if(!this.redis) return;
    const env:CacheEnvelope<T>={
      policyVersion,
      generatedAt:new Date().toISOString(),
      value
    };
    await this.redis.set(key,JSON.stringify(env),"EX",this.ttlSeconds);
  }
}

/**
 * CRITICAL:
 * Cached rows are only candidate/result material.
 * The caller MUST run the existing block/restricted-user/privacy eligibility
 * checks again before returning the page. Redis never grants authorization.
 */
