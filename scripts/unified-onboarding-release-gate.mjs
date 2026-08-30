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
  ["detected country comes from server state", read("server/src/services/onboarding.service.ts").includes("detected_country_code")],
  ["country clarification cannot overwrite evidence", read("server/src/services/countrylinqa/service.ts").includes("COUNTRY_CLARIFICATION_REQUESTED")],
  ["completion requires server acknowledgment", read("clients/mobile/app/onboarding/complete.tsx").includes("acknowledgeCompletion")],
  ["Discovery Settings remains post-onboarding", !read("clients/mobile/app/onboarding/resolve.tsx").includes("settings/countrylinqa")],
  ["Discovery Settings has separate outbound and inbound reach", read("clients/mobile/app/settings/countrylinqa.tsx").includes("Who I can discover") && read("clients/mobile/app/settings/countrylinqa.tsx").includes("Who can discover me")],
  ["inbound reach is server persisted", read("server/src/db/migrations/027_countrylinqa_discovery_controls.sql").includes("country_inbound_reach")],
  ["inbound reach is enforced in discovery scope", read("server/src/services/countrylinqa/feed-scope.ts").includes("country_inbound_links") && read("server/src/services/countrylinqa/feed-scope.ts").includes("CONTACTS_ONLY")],
  ["profile country visibility is enforced in discovery results", read("server/src/services/countrylinqa/discovery.ts").includes("author_preferences.show_country")],
  ["recommendation controls are server enforced", read("server/src/services/countrylinqa/golive/businessRanking.ts").includes("allow_businesses=TRUE") && read("server/src/services/countrylinqa/golive/eventRanking.ts").includes("allow_events=TRUE")],
  ["plan refresh cannot grant local entitlement", !read("clients/mobile/app/settings/countrylinqa.tsx").includes("setPlan")],
  ["account switch clears scoped state", read("clients/mobile/account/AccountContext.tsx").includes("clearAccountScopedState")]
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
if (failed.length) process.exit(1);
