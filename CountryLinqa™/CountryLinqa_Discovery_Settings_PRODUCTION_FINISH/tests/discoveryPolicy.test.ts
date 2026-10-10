import { describe,it,expect } from "vitest";
import { validatePolicy } from "../server/services/countrylinqa/discoveryPolicy";

const base:any = {
  outboundMode:"MY_COUNTRY",
  inboundMode:"MY_COUNTRY",
  outboundCountryCodes:["US"],
  inboundCountryCodes:["US"],
  outboundRegionCode:null,
  inboundRegionCode:null,
  showCountry:true,
  showState:false,
  showCity:false,
  verifiedOnly:true,
  allowBusinesses:true,
  allowCommunities:true,
  allowEvents:true,
  discoveryPaused:false,
  version:1
};

describe("CountryLinqa discovery policy",()=>{
  it("allows Free My Country",()=>{
    expect(validatePolicy({...base},"FREE").outboundMode).toBe("MY_COUNTRY");
  });

  it("blocks region for Free",()=>{
    expect(()=>validatePolicy({...base,outboundMode:"REGION",outboundRegionCode:"AF-W"},"FREE"))
      .toThrow();
  });

  it("blocks worldwide for Premium",()=>{
    expect(()=>validatePolicy({...base,outboundMode:"GLOBAL"},"PREMIUM"))
      .toThrow();
  });

  it("allows worldwide for Elite",()=>{
    expect(validatePolicy({...base,outboundMode:"GLOBAL"},"ELITE").outboundMode)
      .toBe("GLOBAL");
  });

  it("deduplicates country codes",()=>{
    const x=validatePolicy({...base,outboundCountryCodes:["US","US"]},"PREMIUM");
    expect(x.outboundCountryCodes).toEqual(["US"]);
  });
});
