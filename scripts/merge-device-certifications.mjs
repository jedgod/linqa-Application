import fs from "node:fs/promises";

const [inputPath, androidPath, iosPath] = process.argv.slice(2);
if (!inputPath || !androidPath || !iosPath) throw new Error("input, Android result, and iOS result paths required");
const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
const android = JSON.parse(await fs.readFile(androidPath, "utf8"));
const ios = JSON.parse(await fs.readFile(iosPath, "utf8"));
input.devices = [ios, android];
await fs.writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`);
console.log("Bound current physical-device certifications to final release input");
