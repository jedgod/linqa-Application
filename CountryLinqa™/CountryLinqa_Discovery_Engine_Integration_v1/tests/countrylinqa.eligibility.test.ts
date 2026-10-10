import { describe,it,expect } from "vitest";
import { canExposePerson } from "../server/services/countrylinqa/eligibility";

const viewer:any={
  viewerUserId:"viewer",
  viewerCountryCode:"US",
  outboundMode:"SELECTED_COUNTRIES",
  outboundCountryCodes:["US","GH"],
  outboundRegionCode:null,
  inboundMode:"MY_COUNTRY",
  inboundCountryCodes:[],
  inboundRegionCode:null,
  verifiedOnly:true,
  discoveryPaused:false,
  allowBusinesses:true,
  allowCommunities:true,
  allowEvents:true
};

function candidate(overrides:any={}):any {
  return {
    userId:"candidate",
    verifiedCountryCode:"GH",
    verified:true,
    inboundMode:"GLOBAL",
    inboundCountryCodes:[],
    inboundRegionCode:null,
    discoveryPaused:false,
    ...overrides
  };
}

describe("CountryLinqa mutual discovery eligibility",()=>{
  it("allows mutually eligible user",()=>{
    expect(canExposePerson({
      viewer,candidate:candidate(),isExistingContact:false,isBlocked:false
    })).toBe(true);
  });

  it("block overrides geography",()=>{
    expect(canExposePerson({
      viewer,candidate:candidate(),isExistingContact:false,isBlocked:true
    })).toBe(false);
  });

  it("viewer verified-only excludes unverified candidate",()=>{
    expect(canExposePerson({
      viewer,candidate:candidate({verified:false}),isExistingContact:false,isBlocked:false
    })).toBe(false);
  });

  it("candidate contacts-only rejects strangers",()=>{
    expect(canExposePerson({
      viewer,candidate:candidate({inboundMode:"CONTACTS_ONLY"}),
      isExistingContact:false,isBlocked:false
    })).toBe(false);
  });

  it("candidate contacts-only permits existing contact",()=>{
    expect(canExposePerson({
      viewer,candidate:candidate({inboundMode:"CONTACTS_ONLY"}),
      isExistingContact:true,isBlocked:false
    })).toBe(true);
  });

  it("candidate pause discovery rejects new discovery",()=>{
    expect(canExposePerson({
      viewer,candidate:candidate({discoveryPaused:true}),
      isExistingContact:false,isBlocked:false
    })).toBe(false);
  });
});
