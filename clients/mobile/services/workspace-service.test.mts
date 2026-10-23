import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { WorkspaceApiError, WorkspaceService } from "./workspace.service.ts";
import { workspaceKey } from "./workspace-crypto.ts";
import { emptyEvent, emptyNote } from "./workspace-model.ts";

const random = (n: number) => new Uint8Array(randomBytes(n));
const key = workspaceKey(random(32));

// A stand-in server that keeps what it is sent, so the test can look at exactly what left the phone.
function fakeServer() {
  const notes = new Map<string, { ciphertextBase64: string; createdAt: string; updatedAt: string }>();
  const events = new Map<string, any>();
  const wire: string[] = [];
  let n = 0;
  const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname, method = init.method ?? "GET", body = init.body ? JSON.parse(String(init.body)) : undefined;
    wire.push(`${method} ${url} ${init.body ?? ""}`);
    assert.match(String((init.headers as any).authorization), /^Bearer tok$/);
    if (path === "/v2/notes" && method === "GET") return json(200, { items: [...notes].map(([id, v]) => ({ id, noteType: "NOTE", ...v })) });
    if (path === "/v2/notes" && method === "POST") {
      const id = "n" + ++n;
      notes.set(id, { ciphertextBase64: body.ciphertextBase64, createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" });
      return json(201, { id, note_type: "NOTE", created_at: "2026-06-01T00:00:00.000Z", updated_at: "2026-06-01T00:00:00.000Z" });
    }
    const note = path.match(/^\/v2\/notes\/(.+)$/);
    if (note && method === "PUT") {
      const cur = notes.get(note[1]!);
      if (!cur) return json(404, { error: "NOTE_NOT_FOUND" });
      cur.ciphertextBase64 = body.ciphertextBase64; cur.updatedAt = "2026-06-02T00:00:00.000Z";
      return json(200, { id: note[1], noteType: "NOTE", ...cur });
    }
    if (note && method === "DELETE") return notes.delete(note[1]!) ? json(204, null) : json(404, { error: "NOTE_NOT_FOUND" });
    if (path === "/v2/calendar/events" && method === "POST") { const id = "e" + ++n; events.set(id, { id, ...body }); return json(201, { id }); }
    if (path === "/v2/calendar/events" && method === "GET") return json(200, { items: [...events.values()].map((e) => ({ descriptionCiphertextBase64: null, ...e })) });
    const ev = path.match(/^\/v2\/calendar\/events\/(.+)$/);
    if (ev && method === "PUT") { Object.assign(events.get(ev[1]!), body); return json(200, {}); }
    if (path === "/v2/enterprise/organizations/x") return json(404, { error: "ORGANIZATION_NOT_FOUND" });
    return json(500, { error: "unexpected" });
  }) as typeof fetch;
  return { notes, events, wire, fetchImpl };
}

const service = (server: ReturnType<typeof fakeServer>, k = key) =>
  new WorkspaceService({ apiBaseUrl: "https://api.test", getAccessToken: async () => "tok", getKey: async () => k, random, fetchImpl: server.fetchImpl });

// Notes round trip, and the server never holds readable text.
{
  const server = fakeServer(), api = service(server);
  const created = await api.createNote({ ...emptyNote(), title: "Passport number", body: "X1234567", tags: ["travel"], pinned: true });
  assert.equal(created.id, "n1");
  assert.equal(server.wire.join("\n").includes("Passport"), false);
  assert.equal(server.wire.join("\n").includes("X1234567"), false);
  const { notes, unreadable } = await api.notes();
  assert.equal(unreadable, 0);
  assert.deepEqual(notes.map((x) => [x.title, x.body, x.pinned, x.tags]), [["Passport number", "X1234567", true, ["travel"]]]);
  const saved = await api.saveNote("n1", { ...emptyNote(), title: "Passport number", body: "changed", locked: true });
  assert.equal(saved.updatedAt, "2026-06-02T00:00:00.000Z");
  assert.equal((await api.notes()).notes[0]!.body, "changed");
  assert.equal(server.wire.join("\n").includes("changed"), false);
  await assert.rejects(api.saveNote("nope", emptyNote()), (e: any) => e instanceof WorkspaceApiError && e.code === "NOTE_NOT_FOUND" && e.status === 404);
  await api.deleteNote("n1");
  assert.equal((await api.notes()).notes.length, 0);
}

// A checklist and a drawing keep their own type on the server, and their items and strokes stay sealed.
{
  const server = fakeServer(), api = service(server);
  await api.createNote({ ...emptyNote("CHECKLIST"), title: "Groceries", items: [{ id: "1", text: "Oat milk", done: true }] });
  await api.createNote({ ...emptyNote("DRAWING"), title: "Floor plan", strokes: [{ color: "#fff", width: 6, d: "M1 1L9 9" }] });
  const sent = server.wire.filter((w) => w.startsWith("POST"));
  assert.match(sent[0]!, /"noteType":"CHECKLIST"/);
  assert.match(sent[1]!, /"noteType":"DRAWING"/);
  assert.equal(server.wire.join("\n").includes("Oat milk"), false);
  assert.equal(server.wire.join("\n").includes("M1 1L9 9"), false);
  const { notes } = await api.notes();
  const list = notes.find((n) => n.kind === "CHECKLIST")!;
  assert.deepEqual(list.items, [{ id: "1", text: "Oat milk", done: true }]);
  assert.deepEqual(notes.find((n) => n.kind === "DRAWING")!.strokes, [{ color: "#fff", width: 6, d: "M1 1L9 9" }]);
}

// Notes sealed with a different key are counted, never shown.
{
  const server = fakeServer();
  await service(server).createNote({ ...emptyNote(), title: "mine", body: "x" });
  const other = await service(server, workspaceKey(random(32))).notes();
  assert.deepEqual(other, { notes: [], unreadable: 1 });
  server.notes.set("junk", { ciphertextBase64: "AAAA", createdAt: "x", updatedAt: "x" });
  assert.equal((await service(server).notes()).unreadable, 1);
}

// Calendar: title, place and link are sealed; only the times are readable by the server.
{
  const server = fakeServer(), api = service(server);
  const start = new Date("2026-06-10T13:00:00Z"), end = new Date("2026-06-10T13:30:00Z");
  await api.createEvent({ ...emptyEvent(), title: "Therapy", location: "12 Elm St", meetingUrl: "https://meet.example/private", description: "bring notes" }, start, end);
  const sent = server.wire.join("\n");
  for (const secret of ["Therapy", "Elm", "meet.example", "bring notes"]) assert.equal(sent.includes(secret), false, secret);
  assert.equal(sent.includes("2026-06-10T13:00:00.000Z"), true);
  const { events, unreadable } = await api.events({ from: "2026-06-01T00:00:00.000Z", to: "2026-07-01T00:00:00.000Z" });
  assert.equal(unreadable, 0);
  assert.deepEqual([events[0]!.title, events[0]!.location, events[0]!.meetingUrl, events[0]!.description], ["Therapy", "12 Elm St", "https://meet.example/private", "bring notes"]);
  assert.match(server.wire.at(-1)!, /from=2026-06-01T00%3A00%3A00.000Z&to=2026-07-01/);
  await api.saveEvent("e1", { ...emptyEvent(), title: "Therapy (moved)", description: "" }, new Date("2026-06-11T13:00:00Z"), new Date("2026-06-11T14:00:00Z"));
  const after = (await api.events({ from: "a", to: "b" })).events[0]!;
  assert.deepEqual([after.title, after.description, after.startsAt], ["Therapy (moved)", "", "2026-06-11T13:00:00.000Z"]);
}

// Errors carry a stable code, and an unrecognised failure never exposes server text.
{
  const server = fakeServer(), api = service(server);
  await assert.rejects(api.organization("x"), (e: any) => e instanceof WorkspaceApiError && e.code === "ORGANIZATION_NOT_FOUND");
  await assert.rejects(api.policies("y"), (e: any) => e instanceof WorkspaceApiError && e.code === "unexpected");
}
console.log("workspace-service: ok");
