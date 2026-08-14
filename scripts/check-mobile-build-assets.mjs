import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "clients/mobile");
const forbidden = new Set([".icns", ".jxl", ".heif", ".heic"]);
const ignored = new Set(["node_modules", "build", ".gradle", ".expo"]);
const violations = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (forbidden.has(path.extname(entry.name).toLowerCase())) violations.push(path.relative(root, full));
  }
}

walk(root);
if (violations.length) throw new Error(`UNSAFE_METRO_IMAGE_ASSETS:${violations.join(",")}`);
console.log("Mobile build asset policy GREEN: no ICNS/JXL/HEIF/HEIC assets");
