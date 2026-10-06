// CountryLinqa people discovery under load.
//   k6 run -e BASE_URL=https://api.example.com -e TEST_TOKEN=<access token> tests/load/k6-countrylinqa-discovery.js
// Use a token for a seeded, verified test account in a staging environment, never production.
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    discovery: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 50 },
        { duration: "5m", target: 200 },
        { duration: "2m", target: 0 }
      ]
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<350", "p(99)<800"]
  }
};

const BASE = __ENV.BASE_URL;
const TOKEN = __ENV.TEST_TOKEN;
const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

export default function () {
  const first = http.post(`${BASE}/v1/countrylinqa/discover/people/search`, JSON.stringify({ filters: { verifiedOnly: true }, limit: 30 }), { headers });
  check(first, { "search 200": (r) => r.status === 200 });
  const cursor = first.status === 200 ? first.json("nextCursor") : null;
  if (cursor) {
    const next = http.post(`${BASE}/v1/countrylinqa/discover/people/search`, JSON.stringify({ filters: { verifiedOnly: true }, limit: 30, cursor }), { headers });
    check(next, { "page 200": (r) => r.status === 200 });
  }
  sleep(1);
}
