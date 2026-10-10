import { countriesForRegion } from "./regionCatalog.js";
import type { EffectiveDiscoveryPolicy } from "./types.js";

export type Candidate = {
  userId:string;
  verifiedCountryCode:string;
  verified:boolean;
  inboundMode:"MY_COUNTRY"|"SELECTED_COUNTRIES"|"REGION"|"GLOBAL"|"CONTACTS_ONLY";
  inboundCountryCodes:string[];
  inboundRegionCode:string|null;
  discoveryPaused:boolean;
};

function outboundAllows(viewer:EffectiveDiscoveryPolicy,candidateCountry:string) {
  switch(viewer.outboundMode) {
    case "MY_COUNTRY": return candidateCountry===viewer.viewerCountryCode;
    case "SELECTED_COUNTRIES": return viewer.outboundCountryCodes.includes(candidateCountry);
    case "REGION": return countriesForRegion(viewer.outboundRegionCode).includes(candidateCountry);
    case "GLOBAL": return true;
  }
}

function inboundAllows(candidate:Candidate,viewerCountry:string,isExistingContact:boolean) {
  if (candidate.discoveryPaused && !isExistingContact) return false;

  switch(candidate.inboundMode) {
    case "MY_COUNTRY": return candidate.verifiedCountryCode===viewerCountry;
    case "SELECTED_COUNTRIES": return candidate.inboundCountryCodes.includes(viewerCountry);
    case "REGION": return countriesForRegion(candidate.inboundRegionCode).includes(viewerCountry);
    case "GLOBAL": return true;
    case "CONTACTS_ONLY": return isExistingContact;
  }
}

export function canExposePerson(input:{
  viewer:EffectiveDiscoveryPolicy;
  candidate:Candidate;
  isExistingContact:boolean;
  isBlocked:boolean;
}) {
  if (input.isBlocked) return false;
  if (input.viewer.verifiedOnly && !input.candidate.verified) return false;
  if (!outboundAllows(input.viewer,input.candidate.verifiedCountryCode)) return false;
  if (!inboundAllows(input.candidate,input.viewer.viewerCountryCode,input.isExistingContact)) return false;
  return true;
}
