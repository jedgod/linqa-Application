import { describe,expect,it,vi } from "vitest";
import { loadConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import type { ProductionKmsProvider } from "../security/kms/production-kms-provider.js";
import { ProviderTokenVaultService } from "../services/linqasend/provider-token-vault.service.js";
import { ProviderOperationService } from "../services/linqasend/provider-operation.service.js";

const env={DATABASE_URL:"postgresql://unused",JWT_ISSUER:"https://test.linqa.local",JWT_AUDIENCE:"linqa-api",JWT_HS256_SECRET:"x".repeat(32),CONTACT_DISCOVERY_SECRET:"c".repeat(32),TOKEN_VAULT_KEY_BASE64:"A".repeat(44),TURN_SHARED_SECRET:"t".repeat(32)};

describe("LinqaSend real-money closure controls",()=>{
  it("defaults to non-money-moving behavior and rejects unsafe flag combinations",()=>{
    const safe=loadConfig(env);expect(safe.LINQASEND_REAL_MONEY_ENABLED).not.toBe(true);expect(safe.LINQASEND_MODE??"SANDBOX_CERTIFICATION").toBe("SANDBOX_CERTIFICATION");
    expect(()=>loadConfig({...env,LINQASEND_REAL_MONEY_ENABLED:"true"})).toThrow(/real money cannot be enabled/);
    expect(()=>loadConfig({...env,LINQASEND_MODE:"LIMITED_LAUNCH",LINQASEND_PUBLIC_ENROLLMENT:"true"})).toThrow(/public enrollment is forbidden/);
  });

  it("envelope-encrypts provider references and audits decryption",async()=>{
    const key=Buffer.alloc(32,7);let stored:any[]=[];const query=vi.fn(async(sql:string,params?:any[])=>{
      if(sql.startsWith("INSERT INTO linqasend_provider_secrets")){stored=params??[];return{rows:[],rowCount:1};}
      if(sql.startsWith("SELECT * FROM linqasend_provider_secrets"))return{rows:[{id:stored[0],owner_user_id:stored[1],provider_id:stored[2],secret_kind:stored[3],encrypted_data_key:stored[4],ciphertext:stored[5],nonce:stored[6],auth_tag:stored[7]}],rowCount:1};
      return{rows:[],rowCount:1};
    });
    const kms:ProductionKmsProvider={generateDataKey:async()=>({plaintext:Buffer.from(key),ciphertext:Buffer.from("wrapped")}),decrypt:async()=>Buffer.from(key),encrypt:async()=>Buffer.alloc(0),health:async()=>({state:"READY",keyId:"k",checkedAt:new Date().toISOString()})};
    const vault=new ProviderTokenVaultService({query} as unknown as Database,kms,"kms-key");const ref=await vault.store({ownerUserId:"00000000-0000-4000-8000-000000000001",providerId:"bank",secretKind:"FUNDING_METHOD",plaintext:"provider-secret-token"});
    expect(ref).toMatch(/^vault:/);expect(Buffer.from(stored[5]).includes(Buffer.from("provider-secret-token"))).toBe(false);
    await expect(vault.resolve(ref,{actorId:"worker",purpose:"funding",expectedOwnerUserId:stored[1]})).resolves.toBe("provider-secret-token");
    expect(query.mock.calls.some(([sql])=>String(sql).startsWith("INSERT INTO linqasend_provider_secret_access_audit"))).toBe(true);
  });

  it("does not permit blind retry of an uncertain provider operation",async()=>{
    const db={query:vi.fn(async()=>({rows:[{id:"op-1",state:"UNKNOWN",provider_reference:null}],rowCount:1}))} as unknown as Database;
    const operations=new ProviderOperationService(db);
    await expect(operations.register({transferId:"t",providerId:"bank",operationType:"PAYOUT",idempotencyKey:"idem",payload:{amountMinor:10n}})).rejects.toThrow("PROVIDER_OPERATION_UNKNOWN_REQUIRES_QUERY_OR_REVIEW");
  });
});
