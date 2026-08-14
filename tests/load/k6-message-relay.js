import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    messaging: {
      executor: "ramping-arrival-rate",
      startRate: 10,
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 500,
      stages: [
        { target: 100, duration: "2m" },
        { target: 500, duration: "5m" },
        { target: 1000, duration: "5m" },
        { target: 0, duration: "1m" },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500", "p(99)<1000"],
  },
};

export default function () {
  const payload = JSON.stringify({
    recipientDeviceId: __ENV.RECIPIENT_DEVICE_ID,
    clientMessageId: crypto.randomUUID?.() ?? `${__VU}-${__ITER}`,
    ciphertextBase64: __ENV.CIPHERTEXT_BASE64,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });

  const response = http.post(
    `${__ENV.API_BASE_URL}/v1/relay/envelopes`,
    payload,
    {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${__ENV.ACCESS_TOKEN}`,
      },
    },
  );

  check(response, {
    "relay accepted": (r) => r.status === 200 || r.status === 201,
  });

  sleep(0.1);
}
