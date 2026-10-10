export type ModerationDecision={
  allowed:boolean;
  reason?:string;
};

export interface ModerationProvider {
  canAppearInDiscovery(userId:string):Promise<ModerationDecision>;
  canViewDiscovery(userId:string):Promise<ModerationDecision>;
}

export class CountryLinqaModerationGate {
  constructor(private provider:ModerationProvider){}

  async assertViewer(userId:string) {
    const d=await this.provider.canViewDiscovery(userId);
    if (!d.allowed) throw Object.assign(new Error("DISCOVERY_VIEW_RESTRICTED"),{status:403});
  }

  async candidateAllowed(userId:string) {
    const d=await this.provider.canAppearInDiscovery(userId);
    return d.allowed;
  }
}
