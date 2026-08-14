import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const checks = [
  ["split Create Account", read("clients/mobile/app/welcome.tsx").includes('purpose: "REGISTRATION"')],
  ["split Sign In", read("clients/mobile/app/welcome.tsx").includes('purpose: "LOGIN"')],
  ["server onboarding status", read("server/src/routes/onboarding.ts").includes('/v1/onboarding/status')],
  ["no client-trusted attachment", !read("server/src/routes/multi-account.routes.ts").includes("targetUserId")],
  ["no mounted duplicate phone-first flow", !read("server/src/bootstrap/register-all.ts").includes("registerPhoneFirstRoutes")],
  ["no mounted v5 duplicate phone OTP", !read("server/src/routes/multi-account.routes.ts").includes('/v5/phone-verification')],
  ["phone evidence adapter cannot issue OTP", !read("server/src/services/phone-registration.service.ts").includes("async begin(")],
  ["cold start is server resolved", read("clients/mobile/app/index.tsx").includes('/onboarding/resolve')],
  ["Home has a server route guard", read("clients/mobile/app/(tabs)/_layout.tsx").includes('status.nextStep !== "COMPLETE"')],
  ["CountryLinqa is in onboarding", read("clients/mobile/app/onboarding/country-confirmation.tsx").includes("confirmCountry")],
  ["account switch clears scoped state", read("clients/mobile/account/AccountContext.tsx").includes("clearAccountScopedState")]
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
if (failed.length) process.exit(1);
