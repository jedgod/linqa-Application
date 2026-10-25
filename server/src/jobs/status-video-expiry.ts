import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { StatusVideoService } from "../services/status-video.service.js";
import { createObjectStorage } from "../services/storage/create-object-storage.js";

/**
 * The status-video storage lifecycle, in one scheduled run: takes down posts whose time is up (drops the sealed keys, deletes the
 * ciphertext unless a retention override holds it), finds uploads nobody can use any more (finished but never posted, or abandoned
 * mid-upload), and works through the durable cleanup queue. Safe to run repeatedly; schedule it every few minutes (cron, Kubernetes
 * CronJob). Posts are hidden from every feed the moment they expire, so a late run delays deletion, never access.
 */
const config = loadConfig();
const db = createPool(config);
try {
  const service = new StatusVideoService(db, createObjectStorage(config));
  console.log(await service.runLifecycle());
} finally {
  await db.end();
}
