/**
 * Wire these callbacks to the existing repo-native eligibility functions.
 * This file intentionally does NOT create a second moderation implementation.
 */
export async function recheckCachedCandidates<T extends {userId:string}>(
  rows:T[],
  checks:{
    blocked:(candidateUserId:string)=>Promise<boolean>;
    restricted:(candidateUserId:string)=>Promise<boolean>;
    mutuallyEligible:(candidateUserId:string)=>Promise<boolean>;
  }
){
  const out:T[]=[];
  for(const row of rows){
    if(await checks.blocked(row.userId)) continue;
    if(await checks.restricted(row.userId)) continue;
    if(!(await checks.mutuallyEligible(row.userId))) continue;
    out.push(row);
  }
  return out;
}
