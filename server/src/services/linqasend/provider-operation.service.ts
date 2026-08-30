import { createHash } from "node:crypto";
import type { Database } from "../../db/pool.js";

function stablePayload(payload: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(payload).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,typeof v === "bigint" ? v.toString() : v])));
}

/** Persists provider intent before network I/O and makes uncertain outcomes non-retriable. */
export class ProviderOperationService {
  constructor(private readonly db: Database) {}
  async register(input: { transferId: string; providerId: string; operationType: string; idempotencyKey: string; payload: Record<string, unknown> }): Promise<{ id: string; state: string; providerReference?: string }> {
    const hash = createHash("sha256").update(stablePayload(input.payload)).digest("hex");
    const result = await this.db.query(`INSERT INTO linqasend_provider_operations(transfer_id,provider_id,operation_type,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(provider_id,operation_type,idempotency_key) DO UPDATE SET updated_at=now() WHERE linqasend_provider_operations.request_hash=excluded.request_hash RETURNING id,state,provider_reference`, [input.transferId,input.providerId,input.operationType,input.idempotencyKey,hash]);
    if (!result.rows[0]) throw new Error("PROVIDER_OPERATION_IDEMPOTENCY_PAYLOAD_MISMATCH");
    const row = result.rows[0];
    if (row.state === "UNKNOWN") throw new Error("PROVIDER_OPERATION_UNKNOWN_REQUIRES_QUERY_OR_REVIEW");
    return {id:row.id,state:row.state,...(row.provider_reference ? {providerReference:row.provider_reference} : {})};
  }
  async submitted(id: string): Promise<void> { await this.db.query(`UPDATE linqasend_provider_operations SET state='SUBMITTED',updated_at=now() WHERE id=$1 AND state='REGISTERED'`,[id]); }
  async succeeded(id: string, providerReference: string | undefined, metadata: unknown): Promise<void> { await this.db.query(`UPDATE linqasend_provider_operations SET state='SUCCEEDED',provider_reference=$2,response_metadata=$3,updated_at=now() WHERE id=$1`,[id,providerReference ?? null,JSON.stringify(metadata)]); }
  async failed(id: string, metadata: unknown): Promise<void> { await this.db.query(`UPDATE linqasend_provider_operations SET state='FAILED',response_metadata=$2,updated_at=now() WHERE id=$1`,[id,JSON.stringify(metadata)]); }
  async unknown(id: string, error: unknown): Promise<void> { await this.db.query(`UPDATE linqasend_provider_operations SET state='UNKNOWN',response_metadata=$2,updated_at=now() WHERE id=$1`,[id,JSON.stringify({error:error instanceof Error ? error.message : "unknown"})]); }
}
