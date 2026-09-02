import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { RealtimeHub } from "../realtime/hub.js";
import { publishOutboxBatch, pruneOutbox } from "../chat/chat-outbox.service.js";
import { runDeliveryBatch } from "../chat/chat-delivery.worker.js";

/**
 * Chat background worker: outbox relay, delivery jobs and outbox pruning.
 *
 * Its own process (`npm run chat:workers`) so a slow broadcast fan-out can
 * never occupy an API request handler. Safe to run more than one: every claim
 * uses `FOR UPDATE SKIP LOCKED`, so instances divide the work rather than
 * duplicating it.
 *
 * The hub here is process-local, so this worker publishes durable events for
 * *its own* connections only. Sockets attached to the API process pick the
 * same events up from their own relay pass, and any client that misses both
 * replays from `/v1/chats/:id/events` -- which is why the outbox row, not the
 * socket frame, is the record.
 */
const config = loadConfig();
const db = createPool(config);
const hub = new RealtimeHub();

const OUTBOX_INTERVAL_MS = 1_000;
const DELIVERY_INTERVAL_MS = 5_000;
const PRUNE_INTERVAL_MS = 3_600_000;
const OUTBOX_RETENTION_DAYS = 7;

const log = (event: string, detail: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ worker: "chat", event, at: new Date().toISOString(), ...detail }));
};

let stopping = false;
const stop = () => {
  stopping = true;
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

let nextDeliveryAt = 0;
let nextPruneAt = 0;

log("started");
while (!stopping) {
  try {
    const published = await publishOutboxBatch(db, hub, 200);
    if (published) log("outbox_published", { published });

    const now = Date.now();
    if (now >= nextDeliveryAt) {
      nextDeliveryAt = now + DELIVERY_INTERVAL_MS;
      const jobs = await runDeliveryBatch(db);
      if (jobs) log("delivery_batch", { jobs });
    }
    if (now >= nextPruneAt) {
      nextPruneAt = now + PRUNE_INTERVAL_MS;
      const pruned = await pruneOutbox(db, OUTBOX_RETENTION_DAYS);
      if (pruned) log("outbox_pruned", { pruned });
    }
  } catch (error) {
    // A transient database failure must not kill the worker loop.
    log("iteration_failed", { error: error instanceof Error ? error.message : "UNKNOWN" });
  }
  await new Promise((resolve) => setTimeout(resolve, OUTBOX_INTERVAL_MS));
}

log("stopping");
await db.end();
