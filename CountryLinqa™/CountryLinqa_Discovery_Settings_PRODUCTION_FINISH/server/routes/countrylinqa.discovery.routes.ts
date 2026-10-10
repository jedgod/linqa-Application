import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { db, tx } from "../db/pool.js";
import { validatePolicy } from "../services/countrylinqa/discoveryPolicy.js";

export const countryLinqaDiscoveryRouter = Router();

countryLinqaDiscoveryRouter.get("/preferences", requireAuth, async (req,res,next) => {
  try {
    const r = await db.query(
      `SELECT * FROM country_discovery_policy_v2 WHERE user_id=$1`,
      [req.auth!.userId]
    );
    res.json(r.rows[0] ?? null);
  } catch (e) { next(e); }
});

countryLinqaDiscoveryRouter.put("/preferences", requireAuth, async (req,res,next) => {
  try {
    // Replace with the existing Linqa entitlement service.
    const plan = req.auth!.entitlements?.countryLinqaPlan ?? "FREE";
    const input = validatePolicy(req.body, plan);

    const result = await tx(async client => {
      const previous = await client.query(
        `SELECT * FROM country_discovery_policy_v2 WHERE user_id=$1 FOR UPDATE`,
        [req.auth!.userId]
      );

      if (previous.rowCount && Number(previous.rows[0].version) !== Number(input.version)) {
        throw Object.assign(new Error("PREFERENCE_VERSION_CONFLICT"), {status:409});
      }

      const nextVersion = previous.rowCount ? Number(previous.rows[0].version)+1 : 1;

      const saved = await client.query(`
        INSERT INTO country_discovery_policy_v2(
          user_id,outbound_mode,inbound_mode,
          outbound_country_codes,inbound_country_codes,
          outbound_region_code,inbound_region_code,
          show_country,show_state,show_city,verified_only,
          allow_businesses,allow_communities,allow_events,
          discovery_paused,version,updated_at
        ) VALUES(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now()
        )
        ON CONFLICT(user_id) DO UPDATE SET
          outbound_mode=EXCLUDED.outbound_mode,
          inbound_mode=EXCLUDED.inbound_mode,
          outbound_country_codes=EXCLUDED.outbound_country_codes,
          inbound_country_codes=EXCLUDED.inbound_country_codes,
          outbound_region_code=EXCLUDED.outbound_region_code,
          inbound_region_code=EXCLUDED.inbound_region_code,
          show_country=EXCLUDED.show_country,
          show_state=EXCLUDED.show_state,
          show_city=EXCLUDED.show_city,
          verified_only=EXCLUDED.verified_only,
          allow_businesses=EXCLUDED.allow_businesses,
          allow_communities=EXCLUDED.allow_communities,
          allow_events=EXCLUDED.allow_events,
          discovery_paused=EXCLUDED.discovery_paused,
          version=EXCLUDED.version,
          updated_at=now()
        RETURNING *
      `,[
        req.auth!.userId,input.outboundMode,input.inboundMode,
        input.outboundCountryCodes,input.inboundCountryCodes,
        input.outboundRegionCode ?? null,input.inboundRegionCode ?? null,
        input.showCountry,input.showState,input.showCity,input.verifiedOnly,
        input.allowBusinesses,input.allowCommunities,input.allowEvents,
        input.discoveryPaused,nextVersion
      ]);

      await client.query(`
        INSERT INTO country_discovery_policy_audit(
          user_id,actor_user_id,old_policy,new_policy,request_id
        ) VALUES($1,$1,$2::jsonb,$3::jsonb,$4)
      `,[
        req.auth!.userId,
        JSON.stringify(previous.rows[0] ?? null),
        JSON.stringify(saved.rows[0]),
        req.headers["x-request-id"] ?? null
      ]);

      return saved.rows[0];
    });

    res.json(result);
  } catch(e) { next(e); }
});
