import fs from "node:fs/promises";
import path from "node:path";

const roots = process.argv.slice(2);
if (roots.length === 0) throw new Error("At least one release-test path is required");
const forbidden = [
  /\b(it|test|describe)\.skip\b/,
  /\b(it|test)\.todo\b/,
  /\bskipIf\s*\(/,
  /\bmockProviderUsed\s*:\s*true\b/,
  /\bFake[A-Z][A-Za-z0-9_]*(Provider|Client|Repository|Service)\b/
];
const extensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const findings = [];

async function visit(target) {
  const stat = await fs.stat(target);
  if (stat.isDirectory()) {
    for (const entry of await fs.readdir(target)) await visit(path.join(target, entry));
    return;
  }
  if (!extensions.has(path.extname(target))) return;
  const lines = (await fs.readFile(target, "utf8")).split(/\r?\n/);
  lines.forEach((text, index) => forbidden.forEach((pattern) => {
    if (pattern.test(text)) findings.push({ file: target, line: index + 1, pattern: String(pattern), text: text.trim() });
  }));
}

for (const root of roots) await visit(root);
if (findings.length) {
  console.error(JSON.stringify(findings, null, 2));
  process.exitCode = 1;
} else console.log("Release-test skipped/mock scan GREEN");
