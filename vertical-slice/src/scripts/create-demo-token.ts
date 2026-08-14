import { SignJWT } from "jose";
import { loadConfig } from "../config.js";

const config = loadConfig();
const [subject, userId, deviceId] = process.argv.slice(2);

if (!subject || !userId || !deviceId) {
  throw new Error(
    "Usage: npm run token:demo -- <subject> <userId> <deviceId>"
  );
}

const key = new TextEncoder().encode(config.JWT_HS256_SECRET);
const now = Math.floor(Date.now() / 1000);

const token = await new SignJWT({
  user_id: userId,
  device_id: deviceId,
  scope: "keys:write messages:send messages:receive"
})
  .setProtectedHeader({ alg: "HS256", typ: "JWT" })
  .setSubject(subject)
  .setIssuer(config.JWT_ISSUER)
  .setAudience(config.JWT_AUDIENCE)
  .setIssuedAt(now)
  .setExpirationTime(now + 3600)
  .sign(key);

console.log(token);
