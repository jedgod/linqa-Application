import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator,requireScope } from "../auth/jwt.js";
import type { GapClosureService } from "../services/gap-closure.service.js";

// The POST /v1/devices/:deviceId/enrollment handler that used to live here
// (backed by DeviceEnrollmentService) was removed on 2026-08-07: it accepted
// any >=64-byte "proof" with no verification and stored it PENDING forever,
// since the one method that would ever verify and activate it,
// DeviceEnrollmentService.complete(), was never called from any route. Real
// device enrollment now happens exclusively through
// POST /v1/device-enrollment/complete in routes/enrollment.ts, which performs
// real Ed25519 proof verification. See docs/reference/assessments/claudeassess.txt, "TODAY ASSESS TXT".
export async function registerGapClosureRoutes(app:FastifyInstance,config:AppConfig,db:Database,services:{gap:GapClosureService}) {
  const authenticate=createAuthenticator(config);

  app.get("/v1/media",async (request,reply)=>{
    try {
      const p=await authenticate(request); requireScope(p,"media:read");
      const q=z.object({mediaType:z.enum(["IMAGE","VIDEO","VOICE_NOTE","DOCUMENT","LINK","FILE"]).optional(),starredOnly:z.coerce.boolean().optional(),limit:z.coerce.number().int().min(1).max(500).default(200)}).parse(request.query);
      return {media:await services.gap.listMedia({
        userId:p.userId,
        limit:q.limit,
        ...(q.mediaType!==undefined?{mediaType:q.mediaType}:{}),
        ...(q.starredOnly!==undefined?{starredOnly:q.starredOnly}:{})
      })};
    } catch (error) {
      request.log.warn({ err: error }, "media list request rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.get("/v1/privacy-center",async (request,reply)=>{
    try {
      const p=await authenticate(request); requireScope(p,"privacy:read");
      return await services.gap.privacySummary(p.userId);
    } catch (error) {
      request.log.warn({ err: error }, "privacy center request rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.get("/v1/notification-preferences",async(request,reply)=>{
    try {
      const p=await authenticate(request); requireScope(p,"notifications:write");
      const result=await db.query(
        `SELECT messages,calls,communities,business,mentions_only,
                quiet_hours_start,quiet_hours_end,timezone,priority_contact_ids
         FROM notification_preferences_v2 WHERE user_id=$1`,
        [p.userId]
      );
      const row=result.rows[0];
      return row ? {
        messages:row.messages,calls:row.calls,communities:row.communities,
        business:row.business,mentionsOnly:row.mentions_only,
        quietHoursStart:row.quiet_hours_start,quietHoursEnd:row.quiet_hours_end,
        timezone:row.timezone,priorityContactIds:row.priority_contact_ids
      } : {
        messages:true,calls:true,communities:true,business:true,mentionsOnly:false,
        quietHoursStart:null,quietHoursEnd:null,timezone:null,priorityContactIds:[]
      };
    } catch (error) {
      request.log.warn({ err: error }, "notification preferences read rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.put("/v1/notification-preferences",async(request,reply)=>{
    try {
      const p=await authenticate(request); requireScope(p,"notifications:write");
      const b=z.object({messages:z.boolean(),calls:z.boolean(),communities:z.boolean(),business:z.boolean(),mentionsOnly:z.boolean(),quietHoursStart:z.string().nullable().optional(),quietHoursEnd:z.string().nullable().optional(),timezone:z.string().nullable().optional(),priorityContactIds:z.array(z.string().uuid()).default([])}).parse(request.body);
      await db.query(
        `INSERT INTO notification_preferences_v2(user_id,messages,calls,communities,business,mentions_only,quiet_hours_start,quiet_hours_end,timezone,priority_contact_ids)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT(user_id) DO UPDATE SET messages=EXCLUDED.messages,calls=EXCLUDED.calls,communities=EXCLUDED.communities,business=EXCLUDED.business,mentions_only=EXCLUDED.mentions_only,quiet_hours_start=EXCLUDED.quiet_hours_start,quiet_hours_end=EXCLUDED.quiet_hours_end,timezone=EXCLUDED.timezone,priority_contact_ids=EXCLUDED.priority_contact_ids,updated_at=now()`,
        [p.userId,b.messages,b.calls,b.communities,b.business,b.mentionsOnly,b.quietHoursStart??null,b.quietHoursEnd??null,b.timezone??null,b.priorityContactIds]
      );
      return reply.code(204).send();
    } catch (error) {
      request.log.warn({ err: error }, "notification preferences update rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.get("/v1/user-settings",async(request,reply)=>{
    try {
      const p=await authenticate(request); requireScope(p,"settings:write");
      const result=await db.query(
        `SELECT font_scale,reduced_motion,high_contrast,live_captions,
                auto_download_media,auto_cleanup_media,ai_mode
         FROM user_settings_v2 WHERE user_id=$1`,
        [p.userId]
      );
      const row=result.rows[0];
      return row ? {
        fontScale:Number(row.font_scale),reducedMotion:row.reduced_motion,
        highContrast:row.high_contrast,liveCaptions:row.live_captions,
        autoDownloadMedia:row.auto_download_media,
        autoCleanupMedia:row.auto_cleanup_media,aiMode:row.ai_mode
      } : {
        fontScale:1,reducedMotion:false,highContrast:false,liveCaptions:false,
        autoDownloadMedia:false,autoCleanupMedia:true,aiMode:"DISABLED"
      };
    } catch (error) {
      request.log.warn({ err: error }, "user settings read rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.put("/v1/user-settings",async(request,reply)=>{
    try {
      const p=await authenticate(request); requireScope(p,"settings:write");
      const b=z.object({
        fontScale:z.number().min(0.8).max(2),reducedMotion:z.boolean(),
        highContrast:z.boolean(),liveCaptions:z.boolean(),
        autoDownloadMedia:z.boolean(),autoCleanupMedia:z.boolean(),
        aiMode:z.enum(["DISABLED","ON_DEVICE","CONFIDENTIAL_CLOUD"])
      }).parse(request.body);
      await db.query(
        `INSERT INTO user_settings_v2(
           user_id,font_scale,reduced_motion,high_contrast,live_captions,
           auto_download_media,auto_cleanup_media,ai_mode
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(user_id) DO UPDATE SET
           font_scale=EXCLUDED.font_scale,reduced_motion=EXCLUDED.reduced_motion,
           high_contrast=EXCLUDED.high_contrast,live_captions=EXCLUDED.live_captions,
           auto_download_media=EXCLUDED.auto_download_media,
           auto_cleanup_media=EXCLUDED.auto_cleanup_media,ai_mode=EXCLUDED.ai_mode,
           updated_at=now()`,
        [p.userId,b.fontScale,b.reducedMotion,b.highContrast,b.liveCaptions,
          b.autoDownloadMedia,b.autoCleanupMedia,b.aiMode]
      );
      return reply.code(204).send();
    } catch (error) {
      request.log.warn({ err: error }, "user settings update rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}
