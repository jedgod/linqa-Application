import type {FastifyRequest} from 'fastify';
import type {AppConfig} from '../config.js';
import type {SqlClient} from '../db/migration-runner.js';
import {createAuthenticator} from './jwt.js';
import {assertActivePrincipal} from './active-principal.js';

/** Only a verified, active identity can select an account's rate-limit bucket. */
export function authenticatedRateLimitKey(config:AppConfig,db:SqlClient){
  const authenticate=createAuthenticator(config);
  return async(request:FastifyRequest):Promise<string>=>{
    if(request.headers.authorization){
      try{
        const principal=await authenticate(request);
        await assertActivePrincipal(db,principal);
        return 'user:'+principal.userId;
      }catch{/* Invalid credentials share the anonymous IP budget. */}
    }
    return 'ip:'+request.ip;
  };
}
