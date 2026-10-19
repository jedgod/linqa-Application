import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { createServer,type Server } from 'node:http';
import { createHttpLinqaSendProviders } from '../integrations/linqasend/http.providers.js';
import { validateRefundEvidence } from '../services/linqasend/sender-fee-refund.service.js';

describe('sender-fee refund gateway contract over actual loopback HTTP',()=>{
  let server:Server,base:string;let redirectHits=0;
  const calls:Array<{method:string;path:string;authorization:string|undefined;body:any}>=[];
  const stored=new Map<string,any>();
  const request={transferId:'TRANSFER-1',fundingProviderRef:'funding-1',amountMinor:'9007199254740993',currency:'USD',idempotencyKey:'deposit-fee-refund:one/two?x',reasonCode:'INSTANT_FEE_NOT_USED'};
  beforeAll(async()=>{
    server=createServer(async(req,res)=>{
      let body='';for await(const chunk of req)body+=chunk;
      calls.push({method:req.method!,path:req.url!,authorization:req.headers.authorization,body:body?JSON.parse(body):null});
      if(req.headers.authorization!=='Bearer contract-test-token'){res.writeHead(401).end();return;}
      res.setHeader('content-type','application/json');
      if(req.method==='POST'&&req.url==='/funding/refunds'){
        const input=JSON.parse(body);
        // A real gateway replays the original refund for a repeated idempotency key.
        if(!stored.has(input.idempotencyKey))stored.set(input.idempotencyKey,{status:'REFUNDED',providerRef:'refund-1',fundingProviderRef:input.fundingProviderRef,amountMinor:input.amountMinor,currency:input.currency});
        res.end(JSON.stringify(stored.get(input.idempotencyKey)));
      }else if(req.url==='/funding/refunds/lookup/redirect'){res.writeHead(302,{location:'/credential-leak'}).end();}
      else if(req.url==='/credential-leak'){redirectHits++;res.end('{}');}
      else if(req.url==='/funding/refunds/lookup/bad')res.end(JSON.stringify({status:'REFUNDED',providerRef:'r',fundingProviderRef:'f',amountMinor:9000,currency:'USD'}));
      else if(req.url==='/funding/refunds/lookup/zero')res.end(JSON.stringify({status:'REFUNDED',providerRef:'r',fundingProviderRef:'f',amountMinor:'0',currency:'USD'}));
      else if(req.url==='/funding/refunds/lookup/extra')res.end(JSON.stringify({status:'REFUNDED',providerRef:'r',fundingProviderRef:'f',amountMinor:'5',currency:'USD',note:'unexpected'}));
      else if(req.url!.startsWith('/funding/refunds/lookup/')){
        const key=decodeURIComponent(req.url!.slice('/funding/refunds/lookup/'.length));
        res.end(JSON.stringify(stored.get(key)??null));
      }else if(req.url==='/capabilities/wallet')res.end(JSON.stringify({version:'LINQASEND_WALLET_V1',custodyBalances:true,custodyReceiptLookup:true,payoutLookupByIdempotencyKey:true,senderFeeRefunds:true}));
      else res.writeHead(404).end('{}');
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    base=`http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));});
  const funding=()=>createHttpLinqaSendProviders(base,'contract-test-token').funding;

  it('submits an authenticated refund and keeps amounts beyond JavaScript safe integers exact',async()=>{
    const out=await funding().refundFee!({...request,amountMinor:BigInt(request.amountMinor),reasonCode:'INSTANT_FEE_NOT_USED'});
    expect(out).toEqual({status:'REFUNDED',providerRef:'refund-1',fundingProviderRef:'funding-1',amountMinor:request.amountMinor,currency:'USD'});
    const call=calls.find(c=>c.path==='/funding/refunds')!;
    expect(call.method).toBe('POST');expect(call.authorization).toBe('Bearer contract-test-token');expect(call.body).toEqual(request);
  });
  it('looks up the same refund under the encoded original idempotency key and treats unknown keys as null',async()=>{
    expect(await funding().lookupRefundByIdempotencyKey!(request.idempotencyKey)).toMatchObject({providerRef:'refund-1'});
    expect(calls.some(c=>c.path===`/funding/refunds/lookup/${encodeURIComponent(request.idempotencyKey)}`)).toBe(true);
    expect(await funding().lookupRefundByIdempotencyKey!('never-submitted')).toBeNull();
  });
  it('rejects malformed, zero and unexpected-field evidence instead of accepting it',async()=>{
    for(const key of ['bad','zero','extra'])await expect(funding().lookupRefundByIdempotencyKey!(key)).rejects.toThrow();
  });
  it('refuses credential redirects and bad gateway authentication',async()=>{
    await expect(funding().lookupRefundByIdempotencyKey!('redirect')).rejects.toThrow();
    expect(redirectHits).toBe(0);
    await expect(createHttpLinqaSendProviders(base,'wrong').funding.refundFee!({...request,amountMinor:1n,reasonCode:'INSTANT_FEE_NOT_USED'})).rejects.toThrow('linqasend_provider_error:401');
  });
  it('advertises refund support through the wallet capability response',async()=>{
    expect(await createHttpLinqaSendProviders(base,'contract-test-token').custody!.capabilities()).toMatchObject({senderFeeRefunds:true});
  });
  it('requires evidence to echo the funding reference, amount and currency',()=>{
    const scope={fundingProviderRef:'funding-1',amountMinor:'500',currency:'USD'};
    const ok={status:'REFUNDED' as const,providerRef:'r-1',...scope};
    expect(validateRefundEvidence(ok,scope)).toEqual(ok);
    for(const patch of [{fundingProviderRef:'other'},{amountMinor:'501'},{currency:'EUR'},{providerRef:''}])
      expect(()=>validateRefundEvidence({...ok,...patch},scope)).toThrow('SENDER_FEE_REFUND_EVIDENCE_MISMATCH');
  });
});
