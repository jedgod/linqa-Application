import test from "node:test";
import assert from "node:assert/strict";
import { MobileHubService } from "../clients/mobile/services/mobile-hub.service";

test("New chat looks up the full number and opens the canonical shared conversation", async () => {
 const original=globalThis.fetch; const calls: {url:string;body:any}[]=[];
 globalThis.fetch=async(url,init)=>{calls.push({url:String(url),body:JSON.parse(String(init?.body))});return new Response(JSON.stringify(String(url).endsWith("/find")?{contact:{id:"peer-id",displayName:"Greene"}}:{conversationId:"shared-id"}));};
 try {const service=new MobileHubService("http://test",async()=>"test-token");const contact=await service.findChatContact("+14056671120");assert.equal(contact?.displayName,"Greene");assert.deepEqual(await service.createConversation(contact!.id),{id:"shared-id"});assert.deepEqual(calls,[{url:"http://test/v1/chats/contacts/find",body:{phone:"+14056671120"}},{url:"http://test/v1/chats/direct",body:{userId:"peer-id"}}]);}finally{globalThis.fetch=original;}
});

test("unavailable contacts and lookup errors are shown without creating a chat", async()=>{
 const original=globalThis.fetch;
 try {const service=new MobileHubService("http://test",async()=>"test-token");globalThis.fetch=async()=>new Response(JSON.stringify({contact:null}));assert.equal(await service.findChatContact("+14056671120"),null);globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:"INVALID_PHONE_NUMBER"}}),{status:422});await assert.rejects(service.findChatContact("405"),/country code/);globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:"RATE_LIMITED"}}),{status:429});await assert.rejects(service.findChatContact("+14056671120"),/wait a minute/);}finally{globalThis.fetch=original;}
});
