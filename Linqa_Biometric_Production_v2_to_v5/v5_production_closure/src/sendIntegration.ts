import type {Pool} from 'pg';import type {Principal} from './contracts';import type {BiometricAuthorizationService} from './service';
export interface TransferAdapter{loadAuthorizationResourceForUpdate(c:any,id:string,userId:string):Promise<any>;markAuthorized(c:any,id:string):Promise<void>}
export class SendBiometricGate{
 constructor(private db:Pool,private bio:BiometricAuthorizationService,private transfers:TransferAdapter){}
 async authorize(p:Principal,transferId:string,grantId:string){const c=await this.db.connect();try{await c.query('BEGIN');const r=await this.transfers.loadAuthorizationResourceForUpdate(c,transferId,p.userId);await this.bio.consume({client:c,principal:p,grantId,purpose:r.action==='AUTHORIZE_CASHOUT'?'SEND_CASHOUT_AUTHORIZE':'SEND_TRANSFER_AUTHORIZE',resource:r,resourceVersion:r.transferVersion});await this.transfers.markAuthorized(c,transferId);await c.query('COMMIT');return{authorized:true}}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
}
