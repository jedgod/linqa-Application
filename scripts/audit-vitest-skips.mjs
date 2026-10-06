// Rejects hard-coded .skip / .only in test files. (Conditional skips, such as the
// DATABASE_URL-gated integration suites, are checked at run time by
// countrylinqa-db-test-gate.mjs, which fails if any of them actually skipped.)
import fs from "node:fs";
import path from "node:path";

const roots = ["server/src/tests", "clients/mobile", "tests"];
const ignored = new Set(["node_modules", ".expo", "android", "ios", "build", "dist"]);
const offenders = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!ignored.has(entry.name)) walk(file); continue; }
    if (!/\.(test|spec)\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
    fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((raw, i) => {
      // Ignore text inside string literals, such as fixtures for the skip detector itself.
      const line = raw.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
      if (/\b(it|test|describe)\.skip\s*\(/.test(line)) offenders.push(`${file}:${i + 1}: explicit skip`);
      if (/\b(it|test|describe)\.only\s*\(/.test(line)) offenders.push(`${file}:${i + 1}: .only`);
    });
  }
}

roots.forEach(walk);
if (offenders.length) {
  console.error(offenders.join("\n"));
  process.exit(3);
}
console.log("No explicit .skip/.only found.");
