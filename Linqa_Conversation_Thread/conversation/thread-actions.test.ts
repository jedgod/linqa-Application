import { assertPayload, THREAD_ACTIONS, type ThreadAction, type ThreadPayload } from "../conversation/thread-actions";

describe("conversation thread actions", () => {
  it("lists the composer actions from the thread sheet", () => {
    const labels = THREAD_ACTIONS.map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining([
      "Photos", "Location", "Contact", "Document", "Poll", "Event",
      "AI image", "Design / crop", "Share live screen", "Record voice",
      "Record video", "Schedule meeting",
    ]));
  });

  it("requires consent for location, contact, voice, video, and live screen", () => {
    const consent = THREAD_ACTIONS.filter((item) => item.needsConsent).map((item) => item.id);
    expect(consent).toEqual(["VIDEO", "VOICE", "LOCATION", "CONTACT", "LIVE_SCREEN"]);
  });

  it("rejects a poll with one option and a location off the map", () => {
    expect(() => assertPayload("POLL", { kind: "POLL", question: "When?", options: ["Now"], allowsMultiple: false })).toThrow("POLL_NEEDS_TWO_OPTIONS");
    expect(() => assertPayload("LOCATION", { kind: "LOCATION", label: "Site", latitude: 120, longitude: 0 })).toThrow("LOCATION_INVALID");
  });

  it("accepts a vault photo and a meeting draft", () => {
    const photo: ThreadPayload = { kind: "PHOTO", vaultId: "vault_1", width: 1000, height: 800 };
    const meeting: ThreadPayload = { kind: "MEETING", title: "Walkthrough", startsAt: "2026-10-09T14:00:00.000Z", durationMinutes: 45 };
    expect(() => assertPayload("PHOTO", photo)).not.toThrow();
    expect(() => assertPayload("MEETING", meeting)).not.toThrow();
  });

  it("keeps a disabled feature out of the sheet", () => {
    const enabled: ThreadAction[] = ["PHOTO", "POLL", "MEETING"];
    expect(THREAD_ACTIONS.filter((item) => enabled.includes(item.id)).map((item) => item.id)).toEqual(enabled);
  });
});
