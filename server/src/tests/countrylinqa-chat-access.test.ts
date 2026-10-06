import { describe, expect, it } from "vitest";
import { authorizeNewDirectChat, chatReachEntitlements, type ChatPolicy, type Deps } from "../services/countrylinqa/chat-access.js";

const policy = (over: Partial<ChatPolicy> = {}): ChatPolicy => ({ mode: "MY_COUNTRY", countryCodes: [], regionCode: null, existingContactsBypass: true, ...over });
const deps = (over: Partial<Deps> = {}): Deps => ({
  getVerifiedCountry: async (id) => (id === "s" ? "GH" : "US"),
  getChatPolicy: async () => policy(),
  isBlockedEitherDirection: async () => false,
  isRestricted: async () => false,
  hasExistingDirectConversation: async () => false,
  isExistingContact: async () => false,
  countryInRegion: async (c, r) => r === "WEST_AFRICA" && ["GH", "NG"].includes(c),
  ...over
});
const decide = (over: Partial<Deps> = {}) => authorizeNewDirectChat("s", "r", deps(over));

describe("CountryLinqa chat initiation", () => {
  it("denies a foreign country under MY_COUNTRY and allows the same country", async () => {
    expect(await decide()).toMatchObject({ allowed: false, code: "COUNTRY_NOT_ALLOWED" });
    expect((await decide({ getVerifiedCountry: async () => "US" })).allowed).toBe(true);
  });

  it("allows only the selected countries", async () => {
    expect((await decide({ getChatPolicy: async () => policy({ mode: "SELECTED_COUNTRIES", countryCodes: ["gh"] }) })).allowed).toBe(true);
    expect(await decide({ getChatPolicy: async () => policy({ mode: "SELECTED_COUNTRIES", countryCodes: ["NG"] }) })).toMatchObject({ allowed: false, code: "COUNTRY_NOT_ALLOWED" });
  });

  it("allows members of the chosen region only", async () => {
    expect((await decide({ getChatPolicy: async () => policy({ mode: "REGION", regionCode: "WEST_AFRICA", existingContactsBypass: false }) })).allowed).toBe(true);
    expect((await decide({ getVerifiedCountry: async (id) => (id === "s" ? "FR" : "US"), getChatPolicy: async () => policy({ mode: "REGION", regionCode: "WEST_AFRICA" }) })).allowed).toBe(false);
    expect(await decide({ getChatPolicy: async () => policy({ mode: "REGION", regionCode: null }) })).toMatchObject({ allowed: false });
  });

  it("worldwide needs no verified country but blocks and restrictions still win", async () => {
    const worldwide = { getChatPolicy: async () => policy({ mode: "WORLDWIDE" }) };
    expect((await decide({ ...worldwide, getVerifiedCountry: async () => null })).allowed).toBe(true);
    expect(await decide({ ...worldwide, isBlockedEitherDirection: async () => true })).toMatchObject({ allowed: false, code: "BLOCKED" });
    expect(await decide({ ...worldwide, isRestricted: async (id) => id === "r" })).toMatchObject({ allowed: false, code: "RESTRICTED_USER" });
    expect(await decide({ ...worldwide, isRestricted: async (id) => id === "s" })).toMatchObject({ allowed: false, code: "RESTRICTED_USER" });
  });

  it("contacts only and nobody refuse strangers; a contact gets through unless bypass is off", async () => {
    const contactsOnly = { getChatPolicy: async () => policy({ mode: "EXISTING_CONTACTS_ONLY" }) };
    expect(await decide(contactsOnly)).toMatchObject({ allowed: false, code: "CONTACTS_ONLY" });
    expect((await decide({ ...contactsOnly, isExistingContact: async () => true })).allowed).toBe(true);
    expect(await decide({ getChatPolicy: async () => policy({ mode: "NOBODY" }) })).toMatchObject({ allowed: false, code: "CHAT_REQUESTS_DISABLED" });
    expect((await decide({ getChatPolicy: async () => policy({ mode: "NOBODY" }), isExistingContact: async () => true })).allowed).toBe(true);
    expect((await decide({ getChatPolicy: async () => policy({ mode: "NOBODY", existingContactsBypass: false }), isExistingContact: async () => true })).allowed).toBe(false);
  });

  it("never touches an existing conversation, whatever the reach is now", async () => {
    expect(await decide({ hasExistingDirectConversation: async () => true, getChatPolicy: async () => policy({ mode: "NOBODY" }) })).toEqual({ allowed: true, reason: "EXISTING_CONVERSATION" });
  });

  it("a block beats an existing conversation", async () => {
    expect((await decide({ hasExistingDirectConversation: async () => true, isBlockedEitherDirection: async () => true })).allowed).toBe(false);
  });

  it("asks for a verified country when a country rule needs one", async () => {
    expect(await decide({ getVerifiedCountry: async () => null })).toMatchObject({ allowed: false, code: "COUNTRY_UNVERIFIED" });
  });

  it("refuses chatting with yourself", async () => {
    expect(await authorizeNewDirectChat("s", "s", deps())).toMatchObject({ allowed: false, code: "INVALID_RECIPIENT" });
  });

  it("plans: narrowing is free, opening up follows inbound discovery rules", () => {
    expect(chatReachEntitlements("FREE")).toEqual({ MY_COUNTRY: true, SELECTED_COUNTRIES: false, REGION: false, WORLDWIDE: false, EXISTING_CONTACTS_ONLY: true, NOBODY: true });
    expect(chatReachEntitlements("PREMIUM").WORLDWIDE).toBe(false);
    expect(chatReachEntitlements("PREMIUM").REGION).toBe(true);
    expect(chatReachEntitlements("ELITE").WORLDWIDE).toBe(true);
  });
});
