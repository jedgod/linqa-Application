import {describe,it,expect} from "vitest";
import {toPersonDto,toFeedDto} from "../services/countrylinqa/repo-native-adapter";

describe("CountryLinqa repo-native API contract",()=>{
  it("maps snake_case people rows to mobile DTO",()=>{
    expect(toPersonDto({
      id:"u1",display_name:"Ama",verified_country_code:"GH",
      avatar_url:null,identity_verified:true
    })).toEqual({
      id:"u1",displayName:"Ama",countryCode:"GH",
      avatarUrl:null,verified:true
    });
  });

  it("makes body canonical for feed DTO",()=>{
    const dto=toFeedDto({
      id:"p1",body:"Hello Ghana",author_user_id:"u1",
      country_code:"GH",created_at:"2026-10-05T00:00:00Z"
    });
    expect(dto.body).toBe("Hello Ghana");
    expect(dto.title).toBe("Hello Ghana");
  });
});
