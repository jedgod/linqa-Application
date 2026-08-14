import fs from "node:fs/promises";

const [file] = process.argv.slice(2);
if (!file) throw new Error("npm audit JSON path required");
const report = JSON.parse(await fs.readFile(file, "utf8"));
const vulnerabilities = report.metadata?.vulnerabilities ?? {};
const high = Number(vulnerabilities.high ?? 0);
const critical = Number(vulnerabilities.critical ?? 0);
if (high > 0 || critical > 0) throw new Error(`DEPENDENCY_SECURITY_RED:high=${high}:critical=${critical}`);
console.log(`Dependency security GREEN: high=${high}, critical=${critical}`);
