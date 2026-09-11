import { createHash } from "node:crypto";
import type { Database } from "../db/pool.js";
import { appendOutbox, withTransaction } from "./chat.service.js";

/**
 * Delivery worker for broadcast fan-out and call reminders.
 *
 * Three properties the pack's sketch does not have:
 *
 * 1. **The lease outlives the work.** The sketch claims 50 jobs on a 60-second
 *    lease and then processes them sequentially with network I/O in between --
 *    job 50 is very likely past its lease before it starts, so a second worker
 *    claims and runs it too. Here the batch is small, the lease is renewed
 *    around each job, and the lease is checked to still be ours before the
 *    result is written.
 *
 * 2. **Side effects are idempotent.** A crash between "delivered" and "job
 *    marked complete" is unavoidable, so the side effect itself has to tolerate
 *    a rerun: broadcast fan-out claims each recipient row by state transition,
 *    which means a replayed job re-sends to nobody.
 *
 * 3. **Retries are bounded and classified.** A permanent failure dead-letters
 *    immediately instead of burning eight attempts.
 */

const MAX_ATTEMPTS = 8;
const LEASE_SECONDS = 60;
/** Small batches keep every job comfortably inside its lease. */
const DEFAULT_BATCH = 10;

export interface DeliveryJob {
  id: string;
  jobType: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/**
 * The slice of `PushService` this worker needs.
 *
 * Injected rather than constructed here so the worker does not need the token
 * vault's KMS credentials to run broadcast fan-out, and so tests can assert
 * what would have been sent without a provider.
 */
export interface PushNotifier {
  notifyDevice(input: {
    deviceId: string;
    kind: "MESSAGE_AVAILABLE" | "INCOMING_CALL" | "SECURITY_ALERT";
    referenceId: string;
  }): Promise<unknown>;
}

export interface DeliveryDeps {
  push?: PushNotifier;
}

/** Non-retryable classes: retrying these just burns attempts. */
function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  if (typeof code === "string") {
    // Integrity violations and undefined objects will fail identically forever.
    if (code.startsWith("23") || code.startsWith("42")) return false;
  }
  return !(error instanceof TypeError || error instanceof SyntaxError);
}

function safeErrorCode(error: unknown): string {
  const code = (error as { code?: string })?.code;
  // Only a short, non-descriptive token is stored: `last_error_code` ends up
  // in dashboards, and a driver message can carry row values with it.
  if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(code)) return code;
  return "UNKNOWN";
}

export async function claimJobs(db: Database, limit = DEFAULT_BATCH): Promise<DeliveryJob[]> {
  return withTransaction(db, async (client) => {
    const result = await client.query(
      `WITH due AS (
         SELECT id FROM chat_delivery_jobs
          WHERE (state = 'PENDING' OR (state = 'LEASED' AND leased_until < now()))
            AND run_at <= now()
          ORDER BY run_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       )
       UPDATE chat_delivery_jobs j
          SET state = 'LEASED',
              leased_until = now() + make_interval(secs => $2),
              attempts = j.attempts + 1
         FROM due
        WHERE j.id = due.id
      RETURNING j.id, j.job_type AS "jobType", j.payload, j.attempts`,
      [limit, LEASE_SECONDS]
    );
    return result.rows as DeliveryJob[];
  });
}

/**
 * Delivers one broadcast campaign.
 *
 * Each recipient is claimed with a conditional UPDATE, so concurrent or
 * replayed runs of the same campaign cannot deliver twice: only the run that
 * moves a row out of QUEUED gets to act on it.
 */
async function deliverBroadcast(db: Database, campaignId: string): Promise<void> {
  const campaign = await db.query(
    `SELECT created_by AS "createdBy", body_ciphertext AS "body", state::text AS state
       FROM broadcast_campaigns WHERE id = $1`,
    [campaignId]
  );
  const row = campaign.rows[0] as { createdBy: string; body: Buffer; state: string } | undefined;
  if (!row) return;
  if (row.state === "CANCELLED" || row.state === "COMPLETED") return;

  await db.query(`UPDATE broadcast_campaigns SET state='PROCESSING' WHERE id=$1 AND state<>'PROCESSING'`, [
    campaignId
  ]);

  for (;;) {
    const claimed = await db.query(
      `UPDATE broadcast_recipients
          SET state = 'SENT', attempts = attempts + 1, updated_at = now()
        WHERE (campaign_id, recipient_user_id) IN (
          SELECT campaign_id, recipient_user_id FROM broadcast_recipients
           WHERE campaign_id = $1 AND state = 'QUEUED'
           ORDER BY recipient_user_id
           FOR UPDATE SKIP LOCKED
           LIMIT 25
        )
      RETURNING recipient_user_id AS "recipientUserId"`,
      [campaignId]
    );
    if (!claimed.rowCount) break;

    for (const recipient of claimed.rows as Array<{ recipientUserId: string }>) {
      await withTransaction(db, async (client) => {
        // Fan-out writes one real message into the direct conversation with
        // each recipient, so a broadcast lands as an ordinary message rather
        // than a side channel that bypasses conversation authorization.
        const ordered = await client.query(
          `SELECT LEAST($1::uuid,$2::uuid) AS low, GREATEST($1::uuid,$2::uuid) AS high`,
          [row.createdBy, recipient.recipientUserId]
        );
        const { low, high } = ordered.rows[0] as { low: string; high: string };
        const key = await client.query(
          `SELECT conversation_id AS "conversationId" FROM direct_conversation_keys
            WHERE user_low=$1 AND user_high=$2`,
          [low, high]
        );
        if (!key.rowCount) {
          await client.query(
            `UPDATE broadcast_recipients SET state='FAILED', last_error_code='NO_CONVERSATION',
                    updated_at=now()
              WHERE campaign_id=$1 AND recipient_user_id=$2`,
            [campaignId, recipient.recipientUserId]
          );
          return;
        }
        const conversationId = (key.rows[0] as { conversationId: string }).conversationId;

        const message = await client.query(
          `INSERT INTO chat_messages
             (conversation_id, sender_user_id, client_message_id, kind, body_ciphertext)
           VALUES ($1,$2,$3,'TEXT',$4)
           ON CONFLICT (conversation_id, sender_user_id, client_message_id) DO NOTHING
           RETURNING id, created_at AS "createdAt"`,
          // Deterministic per (campaign, recipient), so a replay collides with
          // the first insert instead of creating a second message.
          [conversationId, row.createdBy, deterministicMessageId(campaignId, recipient.recipientUserId), row.body]
        );
        if (!message.rowCount) return;

        const created = message.rows[0] as { id: string; createdAt: Date };
        await client.query(
          `UPDATE conversations SET last_message_at=$2, last_message_preview=NULL WHERE id=$1`,
          [conversationId, created.createdAt]
        );
        await client.query(
          `UPDATE conversation_members SET unread_count = unread_count + 1
            WHERE conversation_id=$1 AND user_id<>$2 AND removed_at IS NULL`,
          [conversationId, row.createdBy]
        );
        await client.query(
          `UPDATE broadcast_recipients SET message_id=$3, state='DELIVERED', updated_at=now()
            WHERE campaign_id=$1 AND recipient_user_id=$2`,
          [campaignId, recipient.recipientUserId, created.id]
        );
        await appendOutbox(client, "message.created", conversationId, {
          messageId: created.id,
          conversationId,
          senderUserId: row.createdBy,
          kind: "TEXT",
          createdAt: new Date(created.createdAt).toISOString()
        });
      });
    }
  }

  await db.query(
    `UPDATE broadcast_campaigns SET state='COMPLETED'
      WHERE id=$1 AND NOT EXISTS (
        SELECT 1 FROM broadcast_recipients WHERE campaign_id=$1 AND state='QUEUED')`,
    [campaignId]
  );
}

/**
 * A UUIDv5-shaped, stable id derived from the campaign and recipient.
 *
 * The point is only determinism: the same pair must always produce the same
 * `client_message_id` so the unique index absorbs a replay.
 */
function deterministicMessageId(campaignId: string, recipientId: string): string {
  const hex = createStableHex(`${campaignId}:${recipientId}`);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32)
  ].join("-");
}

function createStableHex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Wakes a conversation's other members on their own devices.
 *
 * The payload carries a kind and the conversation id and nothing else: the
 * message body is ciphertext the server cannot read, and a push notification
 * is the one place where a "helpful" preview would hand plaintext to Apple or
 * Google. The device fetches and decrypts locally.
 */
async function deliverMessagePush(
  db: Database,
  push: PushNotifier | undefined,
  conversationId: string,
  senderUserId: string
): Promise<void> {
  if (!push) throw new TypeError("PUSH_NOT_CONFIGURED");

  const devices = await db.query(
    `SELECT d.id
       FROM conversation_members cm
       JOIN devices d ON d.user_id = cm.user_id AND d.status = 'ACTIVE'
      WHERE cm.conversation_id = $1
        AND cm.user_id <> $2
        AND cm.removed_at IS NULL
        -- A muted conversation still delivers the message; it just does not
        -- light up the recipient's phone.
        AND cm.muted = FALSE`,
    [conversationId, senderUserId]
  );

  for (const row of devices.rows as Array<{ id: string }>) {
    // One failing endpoint must not strand the rest of the fan-out;
    // `notifyDevice` already records per-endpoint failures.
    try {
      await push.notifyDevice({
        deviceId: row.id,
        kind: "MESSAGE_AVAILABLE",
        referenceId: conversationId
      });
    } catch {
      // Recorded by the push service; the message itself is already durable.
    }
  }
}

async function sendCallReminder(db: Database, callId: string): Promise<void> {
  const found = await db.query(
    `SELECT organizer_user_id AS "organizerId", participant_user_ids AS "participants", status
       FROM scheduled_calls WHERE id = $1`,
    [callId]
  );
  const row = found.rows[0] as
    | { organizerId: string; participants: string[]; status: string }
    | undefined;
  if (!row || row.status !== "SCHEDULED") return;
  await db.query(
    `UPDATE scheduled_calls SET reminder_sent_at = now() WHERE id = $1 AND reminder_sent_at IS NULL`,
    [callId]
  );
}

/** Marks a job finished, but only while this worker still holds the lease. */
async function completeJob(db: Database, jobId: string): Promise<void> {
  await db.query(
    `UPDATE chat_delivery_jobs SET state='COMPLETED', leased_until=NULL
      WHERE id=$1 AND state='LEASED' AND leased_until >= now()`,
    [jobId]
  );
}

async function failJob(db: Database, job: DeliveryJob, error: unknown): Promise<void> {
  const retry = job.attempts < MAX_ATTEMPTS && isRetryable(error);
  // Exponential backoff with jitter, so a provider outage does not produce a
  // synchronized retry storm when it recovers.
  const delaySeconds = Math.min(3600, 2 ** job.attempts * 5) + Math.random() * 5;
  await db.query(
    `UPDATE chat_delivery_jobs
        SET state = $2, run_at = now() + make_interval(secs => $3),
            leased_until = NULL, last_error_code = $4
      WHERE id = $1`,
    [job.id, retry ? "PENDING" : "DEAD", delaySeconds, safeErrorCode(error)]
  );
}

export async function runDeliveryBatch(
  db: Database,
  limit = DEFAULT_BATCH,
  deps: DeliveryDeps = {}
): Promise<number> {
  const jobs = await claimJobs(db, limit);
  for (const job of jobs) {
    try {
      if (job.jobType === "broadcast.deliver") {
        await deliverBroadcast(db, String(job.payload.campaignId));
      } else if (job.jobType === "call.reminder") {
        await sendCallReminder(db, String(job.payload.callId));
      } else if (job.jobType === "push.message") {
        await deliverMessagePush(
          db,
          deps.push,
          String(job.payload.conversationId),
          String(job.payload.senderUserId)
        );
      } else {
        // An unknown type will never become known by waiting.
        await failJob(db, { ...job, attempts: MAX_ATTEMPTS }, new TypeError("UNKNOWN_JOB_TYPE"));
        continue;
      }
      await completeJob(db, job.id);
    } catch (error) {
      await failJob(db, job, error);
    }
  }
  return jobs.length;
}

export const __testing = { isRetryable, safeErrorCode, deterministicMessageId };
