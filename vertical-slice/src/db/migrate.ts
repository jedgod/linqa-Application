import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../config.js";
import { createPool } from "./pool.js";

const config = loadConfig();
const db = createPool(config);
const sql = await readFile(resolve("src/db/migrations/001_vertical_slice.sql"), "utf8");

try {
  await db.query(sql);
  console.log("Migration 001_vertical_slice applied.");
} finally {
  await db.end();
}
