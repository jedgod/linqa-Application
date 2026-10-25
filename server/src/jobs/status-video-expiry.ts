import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { StatusVideoService } from "../services/status-video.service.js";
import { createObjectStorage } from "../services/storage/create-object-storage.js";

/**
 * Takes down every status video whose time is up: drops the sealed keys and deletes the stored ciphertext (unless a retention
 * override holds it). Safe to run repeatedly; schedule it every few minutes (cron, Kubernetes CronJob). Posts are already hidden
 * from every feed the moment they expire, so a late run delays deletion, never access.
 */
const config = loadConfig();
const db = createPool(config);
try {
  const service = new StatusVideoService(db, createObjectStorage(config));
  let total = 0;
  for (;;) {
    const n = await service.expireDue(200);
    total += n;
    if (n < 200) break;
  }
  console.log({ expiredStatusVideos: total });
} finally {
  await db.end();
}
