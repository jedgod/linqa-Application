export type KillSwitchState={
  globalDiscoveryOff:boolean;
  peopleOff:boolean;
  recommendationWorkersOff:boolean;
  alertsOff:boolean;
  worldwideOff:boolean;
};

export function assertDiscoveryAvailable(s:KillSwitchState,surface:string) {
  if (s.globalDiscoveryOff)
    throw Object.assign(new Error("COUNTRYLINQA_TEMPORARILY_UNAVAILABLE"),{status:503});
  if (surface==="PEOPLE" && s.peopleOff)
    throw Object.assign(new Error("PEOPLE_DISCOVERY_TEMPORARILY_UNAVAILABLE"),{status:503});
}
