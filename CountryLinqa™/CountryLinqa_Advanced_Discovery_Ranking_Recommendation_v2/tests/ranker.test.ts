import { describe,it,expect } from "vitest";
import { rankCandidate,rankAndDiversify } from "../server/services/countrylinqa/advanced/ranker";

const viewer:any={
  userId:"u1",countryCode:"US",
  languages:["English"],interests:["Technology","Travel"],
  professionCode:"ENGINEER"
};

const base:any={
  userId:"u2",countryCode:"GH",verified:true,
  languages:["English"],interests:["Technology"],
  professionCode:"ENGINEER",lastActiveAt:null,
  mutualConnections:2,profileQuality:.8,safetyQuality:.9,freshness:.7
};

describe("ranking",()=>{
  it("provides explainable reasons",()=>{
    const r=rankCandidate(viewer,base);
    expect(r.reasons).toContain("SHARED_INTERESTS");
    expect(r.reasons).toContain("SHARED_LANGUAGE");
    expect(r.score).toBeGreaterThan(0);
  });

  it("limits profession domination",()=>{
    const candidates=Array.from({length:20},(_,i)=>({...base,userId:`u${i+2}`}));
    expect(rankAndDiversify(viewer,candidates,10).length).toBeLessThanOrEqual(10);
  });
});
