import type { Pool } from 'pg';
import type { BiometricStepUpService } from './service';
import type { Principal } from './types';

export type TransferAuthorizationResource = {
  transferId:string;
  amountMinor:string;
  currency:string;
  recipientId:string;
  quoteId:string;
  action:'AUTHORIZE_TRANSFER';
};

export class LinqaSendBiometricAuthorization {
  constructor(private db:Pool,private bio:BiometricStepUpService){}

  resource(t:{id:string;amount_minor:string;currency:string;recipient_id:string;quote_id:string}):TransferAuthorizationResource{
    return {
      transferId:t.id,
      amountMinor:t.amount_minor,
      currency:t.currency,
      recipientId:t.recipient_id,
      quoteId:t.quote_id,
      action:'AUTHORIZE_TRANSFER'
    };
  }

  async authorizeTransfer(principal:Principal,grantId:string,transferId:string){
    const client=await this.db.connect();
    try{
      await client.query('BEGIN');
      const q=await client.query(
        `SELECT id,user_id,amount_minor::text,currency,recipient_id,quote_id,state
         FROM linqasend_transfers WHERE id=$1 FOR UPDATE`,[transferId]
      );
      if(!q.rowCount) throw new Error('TRANSFER_NOT_FOUND');
      const t=q.rows[0];
      if(t.user_id!==principal.userId) throw new Error('TRANSFER_NOT_OWNED');
      if(t.state!=='AWAITING_AUTHORIZATION') throw new Error('TRANSFER_STATE_INVALID');

      await this.bio.consumeGrant({
        client,principal,grantId,purpose:'SEND_TRANSFER_AUTHORIZE',resource:this.resource(t)
      });

      const updated=await client.query(
        `UPDATE linqasend_transfers
         SET state='AUTHORIZED', authorized_at=now(), authorization_method='DEVICE_BIOMETRIC'
         WHERE id=$1 AND state='AWAITING_AUTHORIZATION'
         RETURNING *`,[transferId]
      );
      if(updated.rowCount!==1) throw new Error('TRANSFER_AUTHORIZATION_RACE');
      await client.query('COMMIT');
      return updated.rows[0];
    }catch(e){await client.query('ROLLBACK');throw e}
    finally{client.release()}
  }
}
