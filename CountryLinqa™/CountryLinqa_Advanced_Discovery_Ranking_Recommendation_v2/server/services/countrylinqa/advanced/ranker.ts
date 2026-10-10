import type { RankCandidate, RankedCandidate, ViewerFeatures } from "./types.js";

const clamp=(n:number,min=0,max=1)=>Math.max(min,Math.min(max,n));
const overlap=(a:string[],b:string[])=>{
  if (!a.length || !b.length) return 0;
  const B=new Set(b.map(x=>x.toLowerCase()));
  return a.filter(x=>B.has(x.toLowerCase())).length / Math.max(a.length,b.length);
};

export function rankCandidate(
  viewer:ViewerFeatures,
  c:RankCandidate
):RankedCandidate {
  const interest=overlap(viewer.interests,c.interests);
  const language=overlap(viewer.languages,c.languages);
  const profession=
    viewer.professionCode && c.professionCode===viewer.professionCode ? 1 : 0;
  const mutual=clamp(c.mutualConnections/10);
  const quality=clamp(c.profileQuality);
  const safety=clamp(c.safetyQuality);
  const freshness=clamp(c.freshness);

  // Geographic eligibility is intentionally NOT a ranking weight.
  // It must already have been enforced as a hard policy gate.
  const score =
    interest * 0.25 +
    language * 0.15 +
    profession * 0.10 +
    mutual * 0.18 +
    quality * 0.10 +
    safety * 0.17 +
    freshness * 0.05;

  const reasons:string[]=[];
  if (interest>=0.2) reasons.push("SHARED_INTERESTS");
  if (language>=0.2) reasons.push("SHARED_LANGUAGE");
  if (profession) reasons.push("SIMILAR_PROFESSION");
  if (mutual>0) reasons.push("MUTUAL_CONNECTIONS");
  if (c.verified) reasons.push("VERIFIED_PROFILE");

  return {...c,score,reasons};
}

export function rankAndDiversify(
  viewer:ViewerFeatures,
  candidates:RankCandidate[],
  limit:number
) {
  const ranked=candidates.map(c=>rankCandidate(viewer,c))
    .sort((a,b)=>b.score-a.score);

  // Prevent a single profession from dominating a page.
  const professionCounts=new Map<string,number>();
  const result:RankedCandidate[]=[];

  for (const c of ranked) {
    const key=c.professionCode ?? "NONE";
    const count=professionCounts.get(key) ?? 0;
    if (count>=Math.max(3,Math.ceil(limit*0.35))) continue;
    result.push(c);
    professionCounts.set(key,count+1);
    if (result.length>=limit) break;
  }

  return result;
}
