import { createHmac } from "node:crypto";

export function createTurnCredentials(input: {
  secret: string;
  userId: string;
  ttlSeconds: number;
  urls: string[];
}) {
  const expiresAtUnix = Math.floor(Date.now() / 1000) + input.ttlSeconds;
  const username = `${expiresAtUnix}:${input.userId}`;
  const credential = createHmac("sha1", input.secret)
    .update(username)
    .digest("base64");

  return {
    urls: input.urls,
    username,
    credential,
    expiresAt: new Date(expiresAtUnix * 1000).toISOString()
  };
}