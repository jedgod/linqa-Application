import {describe,it,expect} from "vitest";
import {
  CountryLinqaDistributedCache,
  discoveryCacheKey
} from "../services/countrylinqa/distributed-cache";
import {recheckCachedCandidates} from "../services/countrylinqa/privacy-recheck";
import {countryLinqaCandidatePoolLimit} from "../services/countrylinqa/candidate-window";

class FakeRedis{
  m=new Map<string,string>();
  async get(k:string){return this.m.get(k) ?? null;}
  async set(k:string,v:string){this.m.set(k,v);return "OK";}
  async del(...ks:string[]){for(const k of ks)this.m.delete(k);return ks.length;}
}

describe("CountryLinqa shared cache contract",()=>{
  it("versions cache by policy",async()=>{
    const r=new FakeRedis();
    const c=new CountryLinqaDistributedCache(r as any,30);
    const k=discoveryCacheKey({
      userId:"u1",policyVersion:7,surface:"PEOPLE",filters:{language:"en"}
    });
    await c.set(k,7,[{userId:"u2"}]);
    expect(await c.get(k,7)).toEqual([{userId:"u2"}]);
    expect(await c.get(k,8)).toBeNull();
  });

  it("rechecks privacy after a cache hit",async()=>{
    const rows=[{userId:"ok"},{userId:"blocked"},{userId:"restricted"}];
    const out=await recheckCachedCandidates(rows,{
      blocked:async id=>id==="blocked",
      restricted:async id=>id==="restricted",
      mutuallyEligible:async()=>true
    });
    expect(out.map(x=>x.userId)).toEqual(["ok"]);
  });

  it("hard caps candidate pool",()=>{
    expect(countryLinqaCandidatePoolLimit({COUNTRYLINQA_CANDIDATE_POOL_LIMIT:"5000"} as any))
      .toBe(1000);
  });
});
