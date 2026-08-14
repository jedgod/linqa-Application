import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import { DeviceRepository } from "../repositories/device.repository.js";
import { KeyPackageRepository } from "../repositories/key-package.repository.js";

export async function registerKeyPackageRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database
) {
  const authenticate = createAuthenticator(config);
  const devices = new DeviceRepository(db);
  const packages = new KeyPackageRepository(db);

  app.put("/v1/devices/:deviceId/key-package", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "keys:write");

      const params = z.object({
        deviceId: z.string().uuid()
      }).parse(request.params);

      const body = z.object({
        packageVersion: z.number().int().min(1).max(10),
        packageBase64: z.string().min(64).max(1000000),
        expiresAt: z.string().datetime()
      }).parse(request.body);

      if (principal.deviceId !== params.deviceId) {
        return reply.code(403).send({ error: "device_mismatch" });
      }

      const device = await devices.findActive(params.deviceId, principal.userId);
      if (!device) {
        return reply.code(404).send({ error: "active_device_not_found" });
      }

      const packageBytes = Buffer.from(body.packageBase64, "base64");
      if (packageBytes.length < 48) {
        return reply.code(400).send({ error: "invalid_key_package" });
      }

      const expiresAt = new Date(body.expiresAt);
      if (expiresAt.getTime() <= Date.now()) {
        return reply.code(400).send({ error: "key_package_expired" });
      }

      const packageHash = createHash("sha256").update(packageBytes).digest();

      const published = await packages.publish({
        userId: principal.userId,
        deviceId: params.deviceId,
        packageVersion: body.packageVersion,
        packageBytes,
        packageHash,
        expiresAt
      });

      await db.query(
        `INSERT INTO audit_events (
           actor_user_id, actor_device_id, event_type, target_type, target_id, request_id
         ) VALUES ($1,$2,'KEY_PACKAGE_PUBLISHED','KEY_PACKAGE',$3,$4)`,
        [principal.userId, principal.deviceId, published.id, request.id]
      );

      return reply.code(201).send({
        id: published.id,
        packageHash: packageHash.toString("hex"),
        createdAt: published.created_at
      });
    } catch (error) {
      request.log.warn({ err: error }, "key package publish rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.get("/v1/users/:userId/key-packages", async (request, reply) => {
    try {
      await authenticate(request);

      const params = z.object({
        userId: z.string().uuid()
      }).parse(request.params);

      const rows = await packages.findForUser(params.userId);

      return {
        keyPackages: rows.map((row) => ({
          id: row.id,
          deviceId: row.device_id,
          packageVersion: row.package_version,
          packageBase64: (row.package_bytes as Buffer).toString("base64"),
          packageHash: (row.package_hash as Buffer).toString("hex"),
          expiresAt: row.expires_at,
          createdAt: row.created_at
        }))
      };
    } catch {
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}
