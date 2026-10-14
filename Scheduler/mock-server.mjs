// Stand-in backend for developing the scheduler widgets: node mock-server.mjs  (port 8787)
// Mirrors the join window of the real Linqa server: opens 10 min before the start, closes 60 min after.
import http from "node:http";
import { fileURLToPath } from "node:url";

const OPENS_MS = 10 * 60_000;
const CLOSES_MS = 60 * 60_000;

export function createMockServer({ now = () => Date.now() } = {}) {
  const minutes = (m) => new Date(now() + m * 60_000).toISOString();
  let nextId = 4;
  const calls = [
    { id: "1", title: "Design review", host_name: "Greene", time: minutes(4) },
    { id: "2", title: "Weekly sync", host_name: "Deshante", time: minutes(45) },
    { id: "3", title: "Standup (running)", host_name: "Greene", time: minutes(-20) },
  ].map((c) => ({ ...c, scheduled_at: c.time }));
  const joins = [];

  const view = (c) => {
    const start = Date.parse(c.time);
    return { ...c, joinable: now() >= start - OPENS_MS && now() <= start + CLOSES_MS };
  };
  const send = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };
  const readBody = (req) =>
    new Promise((resolve) => {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
      });
    });

  const server = http.createServer(async (req, res) => {
    // The browser tests call this from another origin.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return send(res, 204);

    const path = new URL(req.url, "http://x").pathname;
    if (req.method === "GET" && path === "/calls/scheduled") {
      return send(res, 200, calls.map(view).sort((a, b) => Date.parse(a.time) - Date.parse(b.time)));
    }
    if (req.method === "POST" && path === "/calls/scheduled") {
      const body = await readBody(req);
      const when = Date.parse(body.scheduled_at ?? body.time);
      if (!Number.isFinite(when) || when <= now()) return send(res, 400, { error: "scheduled_time_in_past" });
      const time = new Date(when).toISOString();
      const call = { id: String(nextId++), title: body.title ?? "Call", host_name: body.host_name ?? "You", time, scheduled_at: time };
      calls.push(call);
      return send(res, 201, view(call));
    }
    const join = path.match(/^\/calls\/([^/]+)\/join$/);
    if (req.method === "POST" && join) {
      const call = calls.find((c) => c.id === join[1]);
      if (!call) return send(res, 404, { success: false, error: "EVENT_NOT_FOUND" });
      if (!view(call).joinable) return send(res, 409, { success: false, error: "NOT_JOINABLE" });
      joins.push({ id: call.id, at: now() });
      return send(res, 200, { success: true, roomId: `room-${call.id}`, appId: "mock-app", roomToken: "mock-token" });
    }
    if (req.method === "GET" && path === "/_joins") return send(res, 200, joins);
    return send(res, 404, { error: "not_found" });
  });
  return { server, calls, joins };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8787);
  createMockServer().server.listen(port, "127.0.0.1", () => console.log(`Mock Linqa scheduler API on http://127.0.0.1:${port}`));
}
