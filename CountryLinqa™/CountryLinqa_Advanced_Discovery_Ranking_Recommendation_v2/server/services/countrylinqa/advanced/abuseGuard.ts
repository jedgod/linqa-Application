export interface AbuseStore {
  increment(key:string,windowSeconds:number):Promise<number>;
}

export class DiscoveryAbuseGuard {
  constructor(private store:AbuseStore){}

  async assertAllowed(input:{
    userId:string;
    installationId:string;
    action:"SEARCH"|"PAGE"|"PROFILE_OPEN"|"SAVE_SEARCH";
  }) {
    const limits={
      SEARCH:{window:60,max:30},
      PAGE:{window:60,max:60},
      PROFILE_OPEN:{window:60,max:90},
      SAVE_SEARCH:{window:3600,max:20}
    } as const;

    const rule=limits[input.action];
    const key=`clq:abuse:${input.action}:${input.userId}:${input.installationId}`;
    const count=await this.store.increment(key,rule.window);

    if (count>rule.max)
      throw Object.assign(new Error("DISCOVERY_RATE_LIMITED"),{
        status:429,
        retryAfter:rule.window
      });
  }
}
