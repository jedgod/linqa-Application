import { createHash } from 'node:crypto';
import type { Database } from '../../db/pool.js';
import type { CustodyAccountScope,CustodyBalance,CustodyProvider } from '../../integrations/linqasend/provider.contracts.js';
import { canonical } from '../../security/biometrics/canonical.js';

export class ProviderCustodyService {
  constructor(private readonly db:Database,private readonly provider?:CustodyProvider){}
  async registerAccount(scope:CustodyAccountScope,now=new Date()) {
    if(!this.provider)throw new Error('CUSTODY_PROVIDER_NOT_CONFIGURED');
    const balance=await this.provider.getBalance(scope);validateCustodyBalance(balance,scope,now);
    const client=await this.db.connect();
    try{
      await client.query('BEGIN');
      const entity=await client.query(`SELECT id FROM linqasend_financial_entities_v7 WHERE id=$1 AND status='ACTIVE' AND due_diligence_status='APPROVED' AND operational_status='HEALTHY' FOR SHARE`,[scope.regulatoryEntityId]);
      if(!entity.rows[0])throw new Error('CUSTODY_ENTITY_NOT_APPROVED');
      await client.query(`INSERT INTO linqasend_provider_custody_accounts(provider_id,regulatory_entity_id,currency,provider_account_ref) VALUES($1,$2,$3,$4) ON CONFLICT(provider_id,provider_account_ref,currency) DO NOTHING`,[scope.providerId,scope.regulatoryEntityId,scope.currency,scope.accountReference]);
      const a=(await client.query(`SELECT * FROM linqasend_provider_custody_accounts WHERE provider_id=$1 AND provider_account_ref=$2 AND currency=$3 FOR UPDATE`,[scope.providerId,scope.accountReference,scope.currency])).rows[0];
      if(a.regulatory_entity_id!==scope.regulatoryEntityId)throw new Error('CUSTODY_ACCOUNT_ALREADY_BOUND_TO_ANOTHER_ENTITY');
      const hash=createHash('sha256').update(canonical(balance)).digest('hex');
      const prior=(await client.query(`SELECT evidence_sha256 FROM linqasend_provider_custody_observations WHERE account_id=$1 AND snapshot_id=$2`,[a.id,balance.snapshotId])).rows[0];
      if(prior&&prior.evidence_sha256!==hash)throw new Error('CUSTODY_SNAPSHOT_REPLAY_MISMATCH');
      if(!prior)await client.query(`INSERT INTO linqasend_provider_custody_observations(account_id,snapshot_id,balance_minor,as_of,evidence_sha256) VALUES($1,$2,$3,$4,$5)`,[a.id,balance.snapshotId,balance.balanceMinor,balance.asOf,hash]);
      await client.query(`UPDATE linqasend_provider_custody_accounts SET active=true WHERE id=$1`,[a.id]);
      await client.query('COMMIT');return a.id as string;
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  async syncAccount(accountId:string,now=new Date()) {
    if(!this.provider)throw new Error('CUSTODY_PROVIDER_NOT_CONFIGURED');
    const account=(await this.db.query(`SELECT * FROM linqasend_provider_custody_accounts WHERE id=$1 AND active`,[accountId])).rows[0];
    if(!account)throw new Error('CUSTODY_ACCOUNT_NOT_ACTIVE');
    const scope={providerId:account.provider_id,regulatoryEntityId:account.regulatory_entity_id,currency:account.currency.trim(),accountReference:account.provider_account_ref};
    const balance=await this.provider.getBalance(scope);
    validateCustodyBalance(balance,scope,now);
    const hash=createHash('sha256').update(canonical(balance)).digest('hex');
    const client=await this.db.connect();
    try{
      await client.query('BEGIN');
      const current=(await client.query(`SELECT * FROM linqasend_provider_custody_accounts WHERE id=$1 AND active FOR UPDATE`,[accountId])).rows[0];
      if(!current||current.provider_id!==scope.providerId||current.regulatory_entity_id!==scope.regulatoryEntityId||current.currency.trim()!==scope.currency||current.provider_account_ref!==scope.accountReference)throw new Error('CUSTODY_SCOPE_CHANGED');
      const prior=(await client.query(`SELECT evidence_sha256 FROM linqasend_provider_custody_observations WHERE account_id=$1 AND snapshot_id=$2`,[accountId,balance.snapshotId])).rows[0];
      if(prior&&prior.evidence_sha256!==hash)throw new Error('CUSTODY_SNAPSHOT_REPLAY_MISMATCH');
      if(!prior)await client.query(`INSERT INTO linqasend_provider_custody_observations(account_id,snapshot_id,balance_minor,as_of,evidence_sha256) VALUES($1,$2,$3,$4,$5)`,[accountId,balance.snapshotId,balance.balanceMinor,balance.asOf,hash]);
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  async coverage(entityId:string,currency:string,now=new Date()) {
    // Single database snapshot: all provider accounts are summed once for this entity/currency.
    const r=(await this.db.query(`SELECT
      coalesce((SELECT liability_minor FROM linqasend_wallet_liabilities_by_entity_v9 WHERE regulatory_entity_id=$1 AND currency=$2),0)::text AS liability,
      coalesce(sum(o.balance_minor),0)::text AS assets,count(a.id)::int AS accounts,
      count(a.id) FILTER(WHERE o.id IS NULL OR o.as_of<$3::timestamptz-interval '5 minutes' OR o.as_of>$3::timestamptz+interval '30 seconds')::int AS unverified
      FROM linqasend_provider_custody_accounts a LEFT JOIN LATERAL(SELECT * FROM linqasend_provider_custody_observations
      WHERE account_id=a.id ORDER BY as_of DESC,observed_at DESC LIMIT 1)o ON true
      WHERE a.active AND a.regulatory_entity_id=$1 AND a.currency=$2`,[entityId,currency,now])).rows[0];
    const status=!r.accounts||r.unverified||BigInt(r.liability)<0n?'UNVERIFIED':BigInt(r.assets)<BigInt(r.liability)?'SHORTFALL':'COVERED';
    return {regulatoryEntityId:entityId,currency,liabilityMinor:String(r.liability),assetMinor:String(r.assets),status};
  }
  async assertWalletCovered(walletId:string) {
    const wallet=(await this.db.query(`SELECT regulatory_entity_id,currency FROM linqasend_wallet_accounts_v2 WHERE id=$1`,[walletId])).rows[0];
    if(!wallet)throw new Error('WALLET_NOT_FOUND');
    const result=await this.coverage(wallet.regulatory_entity_id,wallet.currency.trim());
    if(result.status!=='COVERED')throw new Error(`CUSTODY_${result.status}`);
  }
  async sweep() {
    if(!this.provider)throw new Error('CUSTODY_PROVIDER_NOT_CONFIGURED');
    const accounts=await this.db.query(`SELECT id FROM linqasend_provider_custody_accounts WHERE active ORDER BY id`);
    for(const a of accounts.rows){try{await this.syncAccount(a.id);}catch{await this.alert('CUSTODY_SYNC_FAILED','CUSTODY_ACCOUNT',a.id,{});}}
    const scopes=await this.db.query(`SELECT regulatory_entity_id,currency FROM linqasend_wallet_liabilities_by_entity_v9
      UNION SELECT regulatory_entity_id,currency FROM linqasend_provider_custody_accounts WHERE active`);
    for(const scope of scopes.rows){
      const r=await this.coverage(scope.regulatory_entity_id,scope.currency.trim());
      await this.db.query(`INSERT INTO linqasend_provider_custody_checks(regulatory_entity_id,currency,liability_minor,asset_minor,status) VALUES($1,$2,$3,$4,$5)`,[r.regulatoryEntityId,r.currency,r.liabilityMinor,r.assetMinor,r.status]);
      if(r.status!=='COVERED')await this.alert(`CUSTODY_${r.status}`,'CUSTODY_SCOPE',`${r.regulatoryEntityId}:${r.currency}`,r);
    }
    return {accounts:accounts.rows.length,scopes:scopes.rows.length};
  }
  private async alert(type:string,subjectType:string,id:string,details:unknown){await this.db.query(`INSERT INTO linqasend_operational_alerts(severity,alert_type,subject_type,subject_id,details)
    SELECT 'CRITICAL',$1,$2,$3,$4 WHERE NOT EXISTS(SELECT 1 FROM linqasend_operational_alerts WHERE alert_type=$1 AND subject_type=$2 AND subject_id=$3 AND status='OPEN')`,[type,subjectType,id,JSON.stringify(details)]);}
}
export function validateCustodyBalance(balance:CustodyBalance,scope:{providerId:string;regulatoryEntityId:string;currency:string;accountReference:string},now:Date) {
  for(const key of ['providerId','regulatoryEntityId','currency','accountReference'] as const)if(balance[key]!==scope[key])throw new Error('CUSTODY_SCOPE_MISMATCH');
  if(typeof balance.balanceMinor!=='string'||!/^\d{1,19}$/.test(balance.balanceMinor)||BigInt(balance.balanceMinor)>9223372036854775807n||!balance.snapshotId)throw new Error('CUSTODY_BALANCE_INVALID');
  const age=now.getTime()-Date.parse(balance.asOf);
  if(!Number.isFinite(age)||age>300000||age< -30000)throw new Error('CUSTODY_OBSERVATION_STALE_OR_FUTURE');
}
