import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { resolveDirectConversation } from "../chat/chat.service.js";
import type { PhoneEvidenceProvider, GeoIpProvider } from "../services/countrylinqa/providers.js";
import { CountryLinqaService } from "../services/countrylinqa/service.js";
import type { SubscriptionTier } from "../services/countrylinqa/entitlements.js";

const url = process.env.DATABASE_URL;
const required = process.env.LINQA_REQUIRE_DB_TESTS === "1";
const run = url || required ? describe : describe.skip;

run("CountryLinqa chat access against the database", () => {
  const pool = new pg.Pool({ connectionString: url });
  const db = pool as unknown as Database;
  const users: string[] = [];
  let tier: SubscriptionTier = "ELITE";
  const service = new CountryLinqaService(
    db,
    { COUNTRY_SELECTION_PREMIUM_LIMIT: 20 } as AppConfig,
    { getTier: async () => tier },
    {} as PhoneEvidenceProvider,
    {} as GeoIpProvider
  );

  async function makeUser(country: string | null, status = "ACTIVE"): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO users (id, external_subject, status, verified_country_code, country_verification_state)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, `chat-access-${id}`, status, country, country ? "VERIFIED" : "UNVERIFIED"]
    );
    await pool.query("INSERT INTO user_profiles (user_id, display_name) VALUES ($1,$2)", [id, "Test user"]);
    users.push(id);
    return id;
  }
  const base = { mode: "MY_COUNTRY" as const, selectedCountries: [] as string[], selectedRegions: [] as string[] };
  const setChat = (userId: string, chatReach: NonNullable<Parameters<CountryLinqaService["savePreferences"]>[1]["chatReach"]>) => service.savePreferences(userId, { ...base, chatReach });

  afterAll(async () => {
    if (users.length) {
      await pool.query("DELETE FROM conversations WHERE created_by_user_id = ANY($1)", [users]);
      await pool.query("DELETE FROM users WHERE id = ANY($1)", [users]);
    }
    await pool.end();
  });

  it("by default only the same country can start a new chat", async () => {
    const recipient = await makeUser("US");
    const sameCountry = await makeUser("US");
    const foreign = await makeUser("GH");
    await expect(resolveDirectConversation(db, foreign, recipient)).rejects.toMatchObject({ status: 403, code: "COUNTRY_NOT_ALLOWED" });
    await expect(resolveDirectConversation(db, sameCountry, recipient)).resolves.toMatchObject({ created: true });
  });

  it("an unverified country is refused while a country rule applies, and fine under worldwide", async () => {
    const recipient = await makeUser("US");
    const unverified = await makeUser(null);
    await expect(resolveDirectConversation(db, unverified, recipient)).rejects.toMatchObject({ code: "COUNTRY_UNVERIFIED" });
    await setChat(recipient, { mode: "WORLDWIDE" });
    await expect(resolveDirectConversation(db, unverified, recipient)).resolves.toMatchObject({ created: true });
  });

  it("selected countries let exactly those countries in", async () => {
    const recipient = await makeUser("US");
    const gh = await makeUser("GH");
    const ng = await makeUser("NG");
    const saved = await setChat(recipient, { mode: "SELECTED_COUNTRIES", selectedCountries: ["gh"] });
    expect(saved).toMatchObject({ chatReachMode: "SELECTED_COUNTRIES", chatSelectedCountries: ["GH"] });
    await expect(resolveDirectConversation(db, ng, recipient)).rejects.toMatchObject({ code: "COUNTRY_NOT_ALLOWED" });
    await expect(resolveDirectConversation(db, gh, recipient)).resolves.toMatchObject({ created: true });
  });

  it("my region means the region of the recipient's own country, including regions above it", async () => {
    const recipient = await makeUser("US");
    const canada = await makeUser("CA");
    const ghana = await makeUser("GH");
    const saved = await setChat(recipient, { mode: "REGION" });
    expect(saved.chatRegionCode).toBe("NA");
    await expect(resolveDirectConversation(db, ghana, recipient)).rejects.toMatchObject({ code: "COUNTRY_NOT_ALLOWED" });
    await expect(resolveDirectConversation(db, canada, recipient)).resolves.toMatchObject({ created: true });

    const africa = await makeUser("NG");
    const west = await makeUser("GH");
    await setChat(africa, { mode: "REGION", regionCode: "af" }); // the parent of AF-W
    await expect(resolveDirectConversation(db, west, africa)).resolves.toMatchObject({ created: true });
  });

  it("a block beats worldwide, in both directions, and looks like a missing user", async () => {
    const recipient = await makeUser("US");
    const sender = await makeUser("US");
    await setChat(recipient, { mode: "WORLDWIDE" });
    await pool.query("INSERT INTO blocked_users (blocker_user_id, blocked_user_id) VALUES ($1,$2)", [recipient, sender]);
    await expect(resolveDirectConversation(db, sender, recipient)).rejects.toMatchObject({ status: 404, code: "USER_NOT_FOUND" });
    await expect(resolveDirectConversation(db, recipient, sender)).rejects.toMatchObject({ status: 404 });
  });

  it("a suspended user can not be reached or reach anyone", async () => {
    const recipient = await makeUser("US");
    const suspended = await makeUser("US", "SUSPENDED");
    await setChat(recipient, { mode: "WORLDWIDE" });
    await expect(resolveDirectConversation(db, suspended, recipient)).rejects.toMatchObject({ code: "RESTRICTED_USER" });
  });

  it("changing reach never ends a conversation that already exists", async () => {
    const recipient = await makeUser("US");
    const foreign = await makeUser("GH");
    await setChat(recipient, { mode: "WORLDWIDE" });
    const first = await resolveDirectConversation(db, foreign, recipient);
    await setChat(recipient, { mode: "NOBODY" });
    const again = await resolveDirectConversation(db, foreign, recipient);
    expect(again).toEqual({ conversationId: first.conversationId, created: false });
    const reverse = await resolveDirectConversation(db, recipient, foreign);
    expect(reverse.conversationId).toBe(first.conversationId);
  });

  it("contacts only and nobody keep strangers out and let contacts in, unless the bypass is off", async () => {
    const recipient = await makeUser("US");
    const stranger = await makeUser("US");
    const contact = await makeUser("US");
    await pool.query("INSERT INTO chat_contacts (owner_user_id, contact_user_id, created_via) VALUES ($1,$2,'QR')", [recipient, contact]);
    await setChat(recipient, { mode: "EXISTING_CONTACTS_ONLY" });
    await expect(resolveDirectConversation(db, stranger, recipient)).rejects.toMatchObject({ code: "CONTACTS_ONLY" });
    await expect(resolveDirectConversation(db, contact, recipient)).resolves.toMatchObject({ created: true });

    const second = await makeUser("US");
    const secondContact = await makeUser("US");
    await pool.query("INSERT INTO chat_contacts (owner_user_id, contact_user_id, created_via) VALUES ($1,$2,'SEARCH')", [secondContact, second]); // the sender added the recipient
    await setChat(second, { mode: "NOBODY" });
    await expect(resolveDirectConversation(db, stranger, second)).rejects.toMatchObject({ code: "CHAT_REQUESTS_DISABLED" });
    await expect(resolveDirectConversation(db, secondContact, second)).resolves.toMatchObject({ created: true });

    const third = await makeUser("US");
    const thirdContact = await makeUser("US");
    await pool.query("INSERT INTO chat_contacts (owner_user_id, contact_user_id, created_via) VALUES ($1,$2,'QR')", [third, thirdContact]);
    await setChat(third, { mode: "NOBODY", existingContactsBypass: false });
    await expect(resolveDirectConversation(db, thirdContact, third)).rejects.toMatchObject({ code: "CHAT_REQUESTS_DISABLED" });
  });

  it("each user has their own policy, so one account's choice never leaks to another", async () => {
    const open = await makeUser("US");
    const closed = await makeUser("US");
    const foreign = await makeUser("GH");
    await setChat(open, { mode: "WORLDWIDE" });
    await setChat(closed, { mode: "NOBODY" });
    await expect(resolveDirectConversation(db, foreign, open)).resolves.toMatchObject({ created: true });
    await expect(resolveDirectConversation(db, foreign, closed)).rejects.toMatchObject({ code: "CHAT_REQUESTS_DISABLED" });
    expect((await service.preferences(open)).chatReachMode).toBe("WORLDWIDE");
    expect((await service.preferences(closed)).chatReachMode).toBe("NOBODY");
  });

  it("ten parallel first contacts still make one conversation", async () => {
    const recipient = await makeUser("US");
    const sender = await makeUser("US");
    const results = await Promise.all(Array.from({ length: 10 }, () => resolveDirectConversation(db, sender, recipient)));
    expect(new Set(results.map((r) => r.conversationId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  describe("saving the setting", () => {
    it("a free plan may narrow chat reach but not open it up", async () => {
      tier = "FREE";
      try {
        const user = await makeUser("US");
        await expect(setChat(user, { mode: "WORLDWIDE" })).rejects.toMatchObject({ status: 403, code: "CHAT_REACH_NOT_ENTITLED" });
        await expect(setChat(user, { mode: "SELECTED_COUNTRIES", selectedCountries: ["GH"] })).rejects.toMatchObject({ code: "CHAT_REACH_NOT_ENTITLED" });
        expect(await setChat(user, { mode: "NOBODY" })).toMatchObject({ chatReachMode: "NOBODY", allowedChatModes: { WORLDWIDE: false, NOBODY: true } });
      } finally { tier = "ELITE"; }
    });

    it("selected countries need at least one valid country", async () => {
      const user = await makeUser("US");
      await expect(setChat(user, { mode: "SELECTED_COUNTRIES", selectedCountries: [] })).rejects.toMatchObject({ code: "CHAT_COUNTRY_REQUIRED" });
      await expect(setChat(user, { mode: "SELECTED_COUNTRIES", selectedCountries: ["ZZ"] })).rejects.toMatchObject({ code: "INVALID_COUNTRY" });
      await expect(setChat(user, { mode: "REGION", regionCode: "NOWHERE" })).rejects.toMatchObject({ code: "CHAT_REGION_REQUIRED" });
    });

    it("moving away from selected countries clears them", async () => {
      const user = await makeUser("US");
      await setChat(user, { mode: "SELECTED_COUNTRIES", selectedCountries: ["GH", "NG"] });
      const saved = await setChat(user, { mode: "WORLDWIDE" });
      expect(saved.chatSelectedCountries).toEqual([]);
    });

    it("activation is recorded once and the version moves on every save", async () => {
      const user = await makeUser("US");
      const before = await service.preferences(user);
      expect(before).toMatchObject({ activated: false, chatReachMode: "MY_COUNTRY", chatExistingContactsBypass: true });
      const saved = await service.savePreferences(user, { ...base, chatReach: { mode: "MY_COUNTRY" }, activate: true });
      expect(saved.activated).toBe(true);
      const again = await service.savePreferences(user, { ...base, expectedVersion: saved.version });
      expect(again.activated).toBe(true);
      expect(again.version).toBeGreaterThan(saved.version);
    });
  });
});
