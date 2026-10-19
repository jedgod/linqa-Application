import type { PoolClient } from "pg";
import type { Database } from "../../db/pool.js";
import { canonical } from "../../security/biometrics/canonical.js";

/** Evidence must come from the authenticated payout adapter, never from a customer request. */
export type WalletCreditEvidence = {
  userId: string; amountMinor: string; currency: string; regulatoryEntityId: string;
  jurisdiction: string; jurisdictionVersion: number;
};
export class WalletError extends Error {}
type Leg = { walletId?: string; bucket: string; amount: bigint };

export class WalletLedgerService {
  constructor(private readonly db: Database) {}

  async post(client: PoolClient, input: { ref: string; kind: string; currency: string; transferId?: string; operationId?: string; evidence?: unknown; legs: Leg[] }) {
    if (input.legs.length < 2 || input.legs.some(l => l.amount === 0n) || input.legs.reduce((n,l) => n+l.amount,0n) !== 0n) throw new WalletError("UNBALANCED_WALLET_JOURNAL");
    const inserted = await client.query(`INSERT INTO linqasend_wallet_journals(external_ref,kind,currency,transfer_id,operation_id,evidence)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(external_ref) DO NOTHING RETURNING id`,
      [input.ref,input.kind,input.currency,input.transferId ?? null,input.operationId ?? null,JSON.stringify(input.evidence ?? {})]);
    if (!inserted.rows[0]) return false;
    for (const leg of input.legs) await client.query(`INSERT INTO linqasend_wallet_postings(journal_id,wallet_id,bucket,amount_minor,currency) VALUES($1,$2,$3,$4,$5)`,
      [inserted.rows[0].id,leg.walletId ?? null,leg.bucket,leg.amount.toString(),input.currency]);
    return true;
  }

  /** Called inside transfer completion's transaction. A generic COMPLETED payout is not custody evidence. */
  async creditReceipt(client: PoolClient, transfer: { id: string; recipient_id: string; receive_amount_minor: string; receive_currency: string }, evidence: WalletCreditEvidence, providerRef: string) {
    if (!providerRef || !/^\d+$/.test(evidence.amountMinor) || BigInt(evidence.amountMinor) <= 0n
      || BigInt(evidence.amountMinor) !== BigInt(transfer.receive_amount_minor) || evidence.currency !== transfer.receive_currency.trim()) throw new WalletError("WALLET_CREDIT_EVIDENCE_MISMATCH");
    const prior=(await client.query(`SELECT j.evidence,p.wallet_id FROM linqasend_wallet_journals j JOIN linqasend_wallet_postings p ON p.journal_id=j.id AND p.bucket='AVAILABLE' WHERE j.external_ref=$1`,[`receipt:${transfer.id}`])).rows[0];
    if(prior){
      if(canonical(prior.evidence)!==canonical({...evidence,providerRef}))throw new WalletError("WALLET_CREDIT_REPLAY_MISMATCH");
      return prior.wallet_id as string;
    }
    const recipient = await client.query(`SELECT r.linqa_user_id,p.* FROM linqasend_recipients r JOIN user_jurisdiction_profiles_v2 p ON p.user_id=r.linqa_user_id
      JOIN users u ON u.id=p.user_id AND u.status='ACTIVE' WHERE r.id=$1 AND r.recipient_type='LINQA_USER' FOR SHARE OF p,u`, [transfer.recipient_id]);
    const p = recipient.rows[0];
    if (!p || p.user_id !== evidence.userId || p.regulatory_entity_id !== evidence.regulatoryEntityId
      || p.regulatory_jurisdiction !== evidence.jurisdiction || p.jurisdiction_version !== evidence.jurisdictionVersion) throw new WalletError("WALLET_CUSTODY_SCOPE_MISMATCH");
    await client.query(`INSERT INTO linqasend_wallet_accounts_v2(user_id,jurisdiction,regulatory_entity_id,currency,jurisdiction_version)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,jurisdiction,currency,jurisdiction_version) DO NOTHING`,
      [p.user_id,p.regulatory_jurisdiction,p.regulatory_entity_id,evidence.currency,p.jurisdiction_version]);
    const result = await client.query(`SELECT * FROM linqasend_wallet_accounts_v2 WHERE user_id=$1 AND jurisdiction=$2 AND currency=$3 AND jurisdiction_version=$4 FOR UPDATE`,
      [p.user_id,p.regulatory_jurisdiction,evidence.currency,p.jurisdiction_version]);
    const wallet = result.rows[0];
    if (!wallet || wallet.regulatory_entity_id !== evidence.regulatoryEntityId || wallet.status !== 'ACTIVE') throw new WalletError("WALLET_NOT_ACTIVE");
    if (!wallet.subledger_enabled) {
      if (["ledger_balance_minor","pending_balance_minor","available_balance_minor","held_balance_minor","withdrawable_balance_minor"].some(k => BigInt(wallet[k]) !== 0n)) throw new WalletError("LEGACY_WALLET_RECONCILIATION_REQUIRED");
      await client.query(`UPDATE linqasend_wallet_accounts_v2 SET subledger_enabled=true WHERE id=$1`, [wallet.id]);
    }
    await this.post(client,{ref:`receipt:${transfer.id}`,kind:"RECEIPT",currency:evidence.currency,transferId:transfer.id,evidence:{...evidence,providerRef},legs:[
      {walletId:wallet.id,bucket:"AVAILABLE",amount:BigInt(evidence.amountMinor)}, {bucket:"CUSTODY_CLEARING",amount:-BigInt(evidence.amountMinor)}]});
    return wallet.id as string;
  }

  async reserve(client: PoolClient, walletId: string, userId: string, amount: bigint, currency: string, operationId: string) {
    const result = await client.query(`SELECT * FROM linqasend_wallet_accounts_v2 WHERE id=$1 AND user_id=$2 FOR UPDATE`, [walletId,userId]);
    const w = result.rows[0];
    if (!w || !w.subledger_enabled || w.status !== 'ACTIVE' || w.currency.trim() !== currency) throw new WalletError("WALLET_NOT_ACTIVE");
    if (amount <= 0n || BigInt(w.available_balance_minor) < amount || BigInt(w.withdrawable_balance_minor) < amount) throw new WalletError("WALLET_INSUFFICIENT_FUNDS");
    await this.post(client,{ref:`withdrawal:${operationId}:reserve`,kind:"RESERVE",currency,operationId,legs:[
      {walletId,bucket:"AVAILABLE",amount:-amount},{walletId,bucket:"HELD",amount}]});
  }

  async finish(client: PoolClient, row: { id: string; wallet_id: string; amount_minor: string; net_deposit_minor: string; receiver_fee_minor: string; currency: string }, success: boolean, providerRef?:string) {
    await client.query(`SELECT id FROM linqasend_wallet_accounts_v2 WHERE id=$1 FOR UPDATE`,[row.wallet_id]);
    const amount = BigInt(row.amount_minor), net=BigInt(row.net_deposit_minor), fee=BigInt(row.receiver_fee_minor);
    if (amount !== net+fee) throw new WalletError("WITHDRAWAL_AMOUNT_MISMATCH");
    await this.post(client,{ref:`withdrawal:${row.id}:final`,kind:success?"SETTLE":"RELEASE",currency:row.currency.trim(),operationId:row.id,evidence:{providerRef:providerRef??null},legs:success
      ? [{walletId:row.wallet_id,bucket:"HELD",amount:-amount},{bucket:"PAYOUT_CLEARING",amount:net},...(fee>0n?[{bucket:"FEE_REVENUE",amount:fee}]:[])]
      : [{walletId:row.wallet_id,bucket:"HELD",amount:-amount},{walletId:row.wallet_id,bucket:"AVAILABLE",amount}]});
  }

  async summary(userId: string) {
    const result = await this.db.query(`SELECT id,currency,jurisdiction,regulatory_entity_id,status,subledger_enabled,
      ledger_balance_minor,pending_balance_minor,available_balance_minor,held_balance_minor,withdrawable_balance_minor
      FROM linqasend_wallet_accounts_v2 WHERE user_id=$1 ORDER BY currency,jurisdiction_version DESC`,[userId]);
    return {items:result.rows.map(w=>({id:w.id,currency:w.currency.trim(),jurisdiction:w.jurisdiction,regulatoryEntityId:w.regulatory_entity_id,status:w.status,
      balanceVerified:w.subledger_enabled,postedMinor:String(w.ledger_balance_minor),pendingMinor:String(w.pending_balance_minor),availableMinor:String(w.available_balance_minor),heldMinor:String(w.held_balance_minor),withdrawableMinor:String(w.withdrawable_balance_minor)}))};
  }

  async activity(userId: string, walletId: string) {
    const result = await this.db.query(`SELECT j.external_ref,j.kind,j.currency,j.created_at,p.bucket,p.amount_minor FROM linqasend_wallet_postings p
      JOIN linqasend_wallet_journals j ON j.id=p.journal_id JOIN linqasend_wallet_accounts_v2 w ON w.id=p.wallet_id
      WHERE w.user_id=$1 AND w.id=$2 ORDER BY p.id DESC LIMIT 100`,[userId,walletId]);
    return {items:result.rows.map(r=>({...r,amount_minor:String(r.amount_minor)}))};
  }

  /** A projection mismatch freezes spending; reconciliation never invents correcting money. */
  async reconcileProjections() {
    const client=await this.db.connect();
    try {
    await client.query("BEGIN");
    // Lock before taking the posting snapshot; skip accounts currently being changed rather than freezing on a stale sum.
    const locked=await client.query(`SELECT id FROM linqasend_wallet_accounts_v2 WHERE subledger_enabled ORDER BY id FOR UPDATE SKIP LOCKED`);
    const ids=locked.rows.map(w=>w.id);
    const result=await client.query(`WITH expected AS (
      SELECT w.id,coalesce(sum(p.amount_minor) FILTER(WHERE p.bucket='AVAILABLE'),0) AS available,
      coalesce(sum(p.amount_minor) FILTER(WHERE p.bucket='HELD'),0) AS held,
      coalesce(sum(p.amount_minor) FILTER(WHERE p.bucket='PENDING'),0) AS pending
      FROM linqasend_wallet_accounts_v2 w LEFT JOIN linqasend_wallet_postings p ON p.wallet_id=w.id
      WHERE w.subledger_enabled AND w.id=ANY($1::uuid[]) GROUP BY w.id)
      UPDATE linqasend_wallet_accounts_v2 w SET status='FROZEN' FROM expected e WHERE w.id=e.id AND
      (w.available_balance_minor<>e.available OR w.withdrawable_balance_minor<>e.available OR w.held_balance_minor<>e.held
      OR w.pending_balance_minor<>e.pending OR w.ledger_balance_minor<>e.available+e.held) RETURNING w.id,w.currency`,[ids]);
    for(const row of result.rows)await client.query(`INSERT INTO linqasend_operational_alerts(severity,alert_type,subject_type,subject_id,details)
      SELECT 'CRITICAL','WALLET_PROJECTION_MISMATCH','WALLET',$1,$2 WHERE NOT EXISTS(SELECT 1 FROM linqasend_operational_alerts
      WHERE alert_type='WALLET_PROJECTION_MISMATCH' AND subject_id=$1 AND status='OPEN')`,[row.id,JSON.stringify({currency:row.currency})]);
    await client.query("COMMIT");
    return result.rows.length;
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
}
