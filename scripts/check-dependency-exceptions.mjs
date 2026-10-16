import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const validDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function checkDependencyExceptions({ policy, auditConfig, lockfile, today = new Date().toISOString().slice(0, 10) }) {
  if (!validDate(today) || policy?.version !== 1 || !Array.isArray(policy.exceptions) || !Array.isArray(auditConfig?.allowlist)) throw new Error("DEPENDENCY_EXCEPTION_POLICY_INVALID");
  const entries = policy.exceptions;
  const ids = entries.map(entry => entry.advisory);
  if (new Set(ids).size !== ids.length || new Set(auditConfig.allowlist).size !== auditConfig.allowlist.length || ids.length !== auditConfig.allowlist.length || ids.some(id => !auditConfig.allowlist.includes(id))) throw new Error("DEPENDENCY_ALLOWLIST_REVIEW_MISMATCH");
  for (const entry of entries) {
    if (!/^GHSA-[\w-]+$/.test(entry.advisory) || !/^[a-z0-9-]+$/.test(entry.package) || !validDate(entry.acceptedOn) || !validDate(entry.reviewedOn) || !validDate(entry.reviewBy) || entry.acceptedOn > entry.reviewedOn || entry.reviewedOn > today || entry.reviewBy <= entry.reviewedOn || !entry.scope?.trim() || !entry.rationale?.trim() || entry.source !== `https://github.com/advisories/${entry.advisory}`) throw new Error("DEPENDENCY_EXCEPTION_METADATA_INVALID");
    if (today >= entry.reviewBy) throw new Error(`DEPENDENCY_EXCEPTION_REVIEW_DUE:${entry.package}:${entry.reviewBy}`);
    const installed = Object.entries(lockfile.packages ?? {}).filter(([name]) => name.endsWith(`node_modules/${entry.package}`));
    if (!installed.length || installed.some(([, pkg]) => pkg.version !== entry.reviewedVersion)) throw new Error(`DEPENDENCY_EXCEPTION_VERSION_CHANGED:${entry.package}`);
  }
  return entries.map(entry => ({ package: entry.package, advisory: entry.advisory, reviewedOn: entry.reviewedOn, reviewBy: entry.reviewBy }));
}

export async function checkUpstream(entries, fetcher = fetch) {
  await Promise.all(entries.map(async entry => {
    const response = await fetcher(`https://registry.npmjs.org/${encodeURIComponent(entry.package)}/latest`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`DEPENDENCY_UPSTREAM_CHECK_FAILED:${entry.package}`);
    const data = await response.json();
    if (data.version !== entry.reviewedVersion) throw new Error(`DEPENDENCY_UPSTREAM_REVIEW_REQUIRED:${entry.package}`);
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [policy, auditConfig, lockfile] = await Promise.all(["security/dependency-exceptions.json", "clients/mobile/audit-ci.jsonc", "clients/mobile/package-lock.json"].map(async name => JSON.parse(await readFile(path.join(root, name), "utf8"))));
    const result = checkDependencyExceptions({ policy, auditConfig, lockfile });
    if (process.argv.includes("--check-upstream")) await checkUpstream(policy.exceptions);
    console.log(JSON.stringify({ status: "PASS", exceptions: result }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
