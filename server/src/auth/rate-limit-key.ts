import type {FastifyRequest} from 'fastify';
import type {AppConfig} from '../config.js';
import type {SqlClient} from '../db/migration-runner.js';
import {createAuthenticator} from './jwt.js';

/** Only a verified, active identity can select an account's rate-limit bucket. */
export function authenticatedRateLimitKey(config:AppConfig,db:SqlClient){
  const authenticate=createAuthenticator(config);
  return async(request:FastifyRequest):Promise<string>=>{
    if(request.headers.authorization){
      try{
        const principal=await authenticate(request);
        if(principal.deviceId){const device=await db.query("SELECT id FROM devices WHERE id=$1 AND user_id=$2 AND status='ACTIVE' AND revoked_at IS NULL",[principal.deviceId,principal.userId]);if(!device.rowCount)return 'ip:'+request.ip;}
        return 'user:'+principal.userId;
      }catch{/* Invalid credentials share the anonymous IP budget. */}
    }
    return 'ip:'+request.ip;
  };
}
