import type {Pool} from 'pg';
export class BiometricRecoveryService{
 constructor(private db:Pool){}
 async revokeAll(userId:string,reason:string){
  const c=await this.db.connect();
  try{
   await c.query('BEGIN');
   await c.query(`INSERT INTO biometric_security_state(user_id,security_epoch) VALUES($1,2)
     ON CONFLICT(user_id) DO UPDATE SET security_epoch=biometric_security_state.security_epoch+1,
     recovery_in_progress=true,updated_at=now()`,[userId]);
   await c.query(`UPDATE biometric_credentials SET state='REVOKED',revoked_at=COALESCE(revoked_at,now()),metadata=metadata||jsonb_build_object('revoke_reason',$2) WHERE user_id=$1 AND revoked_at IS NULL`,[userId,reason]);
   await c.query(`UPDATE biometric_challenges SET consumed_at=COALESCE(consumed_at,now()) WHERE user_id=$1 AND consumed_at IS NULL`,[userId]);
   await c.query(`UPDATE biometric_grants SET consumed_at=COALESCE(consumed_at,now()) WHERE user_id=$1 AND consumed_at IS NULL`,[userId]);
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 }
}
