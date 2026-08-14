import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import type { SyncService } from "../services/sync.service.js";

const RecordType = z.enum([
  "MESSAGE",
  "RECEIPT",
  "CONTACT",
  "SETTINGS",
  "GROUP_STATE",
  "TOMBSTONE",
  "BACKUP_POINTER"
]);

export async function registerSyncRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  sync: SyncService
) {
  const authenticate = createAuthenticator(config);

  app.post("/v1/sync/records", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "sync:write");

      if (!principal.deviceId) {
        return reply.code(401).send({ error: "device_bound_token_required" });
      }

      const body = z.object({
        records: z.array(z.object({
          clientRecordId: z.string().uuid(),
          targetDeviceId: z.string().uuid().optional(),
          recordType: RecordType,
          ciphertextBase64: z.string().min(24),
          logicalClock: z.number().int().nonnegative(),
          expiresAt: z.string().datetime().optional()
        })).min(1).max(500)
      }).parse(request.body);

      await sync.push({
        userId: principal.userId,
        sourceDeviceId: principal.deviceId,
        records: body.records.map((record) => ({
          clientRecordId: record.clientRecordId,
          recordType: record.recordType,
          ciphertext: Buffer.from(record.ciphertextBase64, "base64"),
          logicalClock: record.logicalClock,
          ...(record.targetDeviceId !== undefined ? { targetDeviceId: record.targetDeviceId } : {}),
          ...(record.expiresAt !== undefined ? { expiresAt: new Date(record.expiresAt) } : {})
        }))
      });

      return reply.code(202).send({ accepted: body.records.length });
    } catch (error) {
      request.log.warn({ err: error }, "sync push rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.get("/v1/sync/records", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "sync:read");

      if (!principal.deviceId) {
        return reply.code(401).send({ error: "device_bound_token_required" });
      }

      const query = z.object({
        afterClock: z.coerce.number().int().nonnegative().default(0),
        limit: z.coerce.number().int().min(1).max(500).default(100)
      }).parse(request.query);

      const rows = await sync.pull({
        userId: principal.userId,
        targetDeviceId: principal.deviceId,
        afterClock: query.afterClock,
        limit: query.limit
      });

      return {
        records: rows.map((row) => ({
          id: row.id,
          sourceDeviceId: row.source_device_id,
          recordType: row.record_type,
          clientRecordId: row.client_record_id,
          ciphertextBase64: (row.ciphertext as Buffer).toString("base64"),
          logicalClock: Number(row.logical_clock),
          createdAt: row.created_at
        }))
      };
    } catch (error) {
      request.log.warn({ err: error }, "sync pull rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}
