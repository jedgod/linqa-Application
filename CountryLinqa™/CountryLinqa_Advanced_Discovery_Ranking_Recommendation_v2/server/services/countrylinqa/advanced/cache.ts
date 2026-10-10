import crypto from "node:crypto";

export interface RedisLike {
  get(k:string):Promise<string|null>;
  set(k:string,v:string,mode:string,ttl:number):Promise<unknown>;
  del(...keys:string[]):Promise<unknown>;
  scan(cursor:string,...args:any[]):Promise<[string,string[]]>;
}

export function discoveryCacheKey(input:{
  userId:string;
  policyVersion:number;
  surface:string;
  filters:unknown;
  cursor?:string|null;
}) {
  const digest=crypto.createHash("sha256")
    .update(JSON.stringify({filters:input.filters,cursor:input.cursor ?? null}))
    .digest("hex")
    .slice(0,24);
  return `clq:disc:v2:${input.userId}:${input.policyVersion}:${input.surface}:${digest}`;
}

export async function cached<T>(
  redis:RedisLike,
  key:string,
  ttlSeconds:number,
  loader:()=>Promise<T>
):Promise<T> {
  const hit=await redis.get(key);
  if (hit) return JSON.parse(hit);
  const value=await loader();
  await redis.set(key,JSON.stringify(value),"EX",ttlSeconds);
  return value;
}

// Prefer versioned keys. Policy updates increment policy version,
// naturally making old cache entries unreachable. Expiration cleans them up.
