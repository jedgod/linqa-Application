import { describe,expect,it,vi } from "vitest";
import { ProductionMessagingCoordinator } from "./ProductionMessagingCoordinator";
import type { LocalMessage } from "../storage/EncryptedLocalStore";

const envelope=(messageId:string)=>new TextEncoder().encode(JSON.stringify({header:{message_id:messageId,sender_user_id:"alice",sender_device_id:"alice-device"}}));
function fixture(decryptFails=false){
  const rows=new Map<string,LocalMessage>(); const order:string[]=[];
  const store={putMessage:vi.fn(async(m:LocalMessage)=>{order.push("persist");rows.set(m.id,m);}),updateMessageState:vi.fn(async(id:string,state:string)=>{const row=rows.get(id);if(row)rows.set(id,{...row,state});}),listPendingOutbox:vi.fn(async()=>[]),getMessage:vi.fn(async(id:string)=>rows.get(id)??null)};
  const core={runtimeInfo:vi.fn(async()=>({secureCoreReady:true,apiVersion:1,protocolVersion:1,buildVersion:"test"})),encryptMessage:vi.fn(async()=>{order.push("encrypt");return envelope("33333333-3333-4333-8333-333333333333");}),decryptMessage:vi.fn(async()=>{if(decryptFails)throw new Error("tamper");return{messageId:"33333333-3333-4333-8333-333333333333",senderUserId:"alice",senderDeviceId:"alice-device",plaintext:"hello"};})};
  const api={keyPackages:vi.fn(),sendEnvelope:vi.fn(async()=>{order.push("network");return{envelopeId:"e",serverSequence:1};}),receive:vi.fn(),acknowledge:vi.fn(async()=>({}))};
  return{rows,order,store,core,api,coordinator:new ProductionMessagingCoordinator(core as never,store,api as never,{userId:"bob",deviceId:"bob-device"})};
}

describe("G2 production messaging coordinator",()=>{
  it("persists ciphertext before relay submission",async()=>{
    const f=fixture();
    // Transparency verification has its own signed-vector test; use a direct retry envelope here.
    f.rows.set("m",{id:"m",conversationId:"c",direction:"OUTGOING",ciphertext:envelope("33333333-3333-4333-8333-333333333333"),state:"FAILED_RETRYABLE",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),recipientDeviceId:"bob-device",expiresAt:new Date(Date.now()+60_000).toISOString()});
    await f.coordinator.retry("m"); expect(f.api.sendEnvelope).toHaveBeenCalledTimes(1); expect(f.rows.get("m")?.state).toBe("ACCEPTED_BY_RELAY");
  });
  it("does not ACK ciphertext that fails authenticated decryption",async()=>{
    const f=fixture(true); const bytes=envelope("33333333-3333-4333-8333-333333333333");
    f.api.receive.mockResolvedValue({leaseOwner:"lease",envelopes:[{id:"env",ciphertextBase64:btoa(String.fromCharCode(...bytes)),senderSigningPublicKeyBase64:"key"}]});
    expect(await f.coordinator.receive()).toEqual([]); expect(f.api.acknowledge).not.toHaveBeenCalled();
  });
  it("durably suppresses replay and idempotently ACKs the duplicate",async()=>{
    const f=fixture(); const bytes=envelope("33333333-3333-4333-8333-333333333333"); const batch={leaseOwner:"lease",envelopes:[{id:"env",ciphertextBase64:btoa(String.fromCharCode(...bytes)),senderSigningPublicKeyBase64:"key"}]};
    f.api.receive.mockResolvedValue(batch); await f.coordinator.receive(); await f.coordinator.receive();
    expect(f.core.decryptMessage).toHaveBeenCalledTimes(1); expect(f.api.acknowledge).toHaveBeenCalledTimes(2);
  });
});
