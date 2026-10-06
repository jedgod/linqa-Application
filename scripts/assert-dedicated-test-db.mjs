// Refuses to run certification against a database that might hold real data.
// The chat integration suite writes rows, so it must only run on a throwaway database.
//
// Accepted: a database whose name has a "test" or "ci" word in it (linqa_test, countrylinqa_ci_test).
// Override only after checking the target yourself: LINQA_ALLOW_CERT_DB=1.
import { pathToFileURL } from "node:url";

export function checkDedicatedDatabase(raw = process.env.DATABASE_URL, env = process.env) {
  if (!raw) return { ok: false, code: 2, message: "DATABASE_URL missing." };
  let url;
  try { url = new URL(raw); } catch { return { ok: false, code: 2, message: "DATABASE_URL is not a valid URL." }; }
  const db = decodeURIComponent(url.pathname.replace(/^\//, "")).toLowerCase();
  const host = url.hostname.toLowerCase();
  const explicit = env.LINQA_ALLOW_CERT_DB === "1";
  const named = /(^|[_-])(test|ci)([_-]|$)/.test(db);
  const productionLike = /(^|[_-])(prod|production|live)([_-]|$)/.test(db) || ["linqa", "postgres"].includes(db);

  if (productionLike && !explicit) return { ok: false, code: 4, message: `Refusing production-like database "${db}".` };
  if (!named && !explicit) {
    return { ok: false, code: 3, message: `Refusing certification database "${db}". Use a dedicated database whose name contains test or ci, or set LINQA_ALLOW_CERT_DB=1 after verifying it is safe.` };
  }
  return { ok: true, code: 0, message: `Dedicated certification database accepted: ${host}/${db}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkDedicatedDatabase();
  (result.ok ? console.log : console.error)(result.message);
  process.exit(result.code);
}
