import { describe,expect,it,vi } from "vitest";
import { DepositService,assertWithdrawalSnapshot } from "../services/linqasend/deposit.service.js";
import { WalletLedgerService } from "../services/linqasend/wallet-ledger.service.js";
import type { PayoutProvider } from "../integrations/linqasend/provider.contracts.js";
import type { Database } from "../db/pool.js";

function harness(row:any) {
  const query=vi.fn(async(sql:string)=>{
    if(sql.includes("SELECT d.*,t.public_id"))return {rows:row?[row]:[]};
    if(sql.includes("submission_started_at=now()"))return {rows:[{id:row.id}]};
    if(sql.includes("WHERE id=$1 AND lease_token=$2 FOR UPDATE"))return {rows:[row]};
    return {rows:[]};
  });
  const release=vi.fn();return {query,db:{query,connect:async()=>({query,release})} as unknown as Database};
}
function provider():PayoutProvider {return {name:"test",createPayout:vi.fn(async()=>({status:"PROCESSING" as const,providerRef:"p"})),lookup:vi.fn(async()=>null),lookupByIdempotencyKey:vi.fn(async()=>null)};}
const operation={id:"d",public_id:"T",wallet_id:"w",receiver_user_id:"u",destination_ref:"vault:ref",net_deposit_minor:"100",currency:"USD",status:"SCHEDULED",submission_started_at:null};
const policy={authorizePayout:async()=>{},resolveDestination:async()=>"provider-token"};
describe("receipt-backed withdrawal behavior",()=>{
  it("rejects changed authorization details including payout destination and amount",()=>{
    expect(()=>assertWithdrawalSnapshot({amount:"100",destination:"one"},{destination:"one",amount:"100"})).not.toThrow();
    expect(()=>assertWithdrawalSnapshot({amount:"100"},{amount:"101"})).toThrow("withdrawal_details_changed");
    expect(()=>assertWithdrawalSnapshot({destination:"one"},{destination:"two"})).toThrow("withdrawal_details_changed");
  });
  it("does not use a completed transfer as proof that money is in custody",async()=>{
    const query=vi.fn(async()=>({rows:[{status:"COMPLETED",wallet_id:null}]}));
    await expect(new DepositService({query} as unknown as Database,provider()).options("user","T")).rejects.toThrow("wallet_receipt_not_verified");
  });
  it("dispatches only through a resolved provider token and durable identity",async()=>{
    const h=harness(operation),p=provider();await new DepositService(h.db,p,policy).releaseDue();
    expect(p.createPayout).toHaveBeenCalledWith(expect.objectContaining({recipientProviderRef:"provider-token",idempotencyKey:"deposit:d",amountMinor:100n}));
  });
  it("retains an ambiguous payout as reconciling and never releases the hold",async()=>{
    const h=harness(operation),p=provider();vi.mocked(p.createPayout).mockRejectedValue(new Error("timeout"));
    await new DepositService(h.db,p,policy).releaseDue();
    expect(h.query.mock.calls.some(c=>c[0].includes("status=$3"))).toBe(true);
    expect(h.query.mock.calls.some(c=>c[0].includes("wallet_postings"))).toBe(false);
  });
  it("looks up an expired dispatched operation without submitting another payout",async()=>{
    const h=harness({...operation,status:"PROCESSING",submission_started_at:new Date()}),p=provider();
    await new DepositService(h.db,p,policy).releaseDue();
    expect(p.createPayout).not.toHaveBeenCalled();expect(p.lookupByIdempotencyKey).toHaveBeenCalledWith("deposit:d");
  });
  it("fails closed without an explicit withdrawal provider policy",async()=>{
    const h=harness(operation),p=provider();await new DepositService(h.db,p).releaseDue();expect(p.createPayout).not.toHaveBeenCalled();
  });
  it("rejects an unbalanced journal before attempting database writes",async()=>{
    const query=vi.fn();await expect(new WalletLedgerService({} as Database).post({query} as any,{ref:"x",kind:"RECEIPT",currency:"USD",legs:[{bucket:"AVAILABLE",amount:2n},{bucket:"CUSTODY_CLEARING",amount:-1n}]})).rejects.toThrow("UNBALANCED_WALLET_JOURNAL");
    expect(query).not.toHaveBeenCalled();
  });
});
