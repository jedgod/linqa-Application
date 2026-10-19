import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { createServer,type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createHttpLinqaSendProviders } from '../integrations/linqasend/http.providers.js';
import { validateCustodyBalance } from '../services/linqasend/provider-custody.service.js';

describe('existing gateway wallet contract over actual loopback HTTP',()=>{
  let server:Server,base:string;let redirectHits=0;
  const calls:Array<{path:string;authorization:string|undefined;body:any}>=[];
  const scope={providerId:'test-provider',regulatoryEntityId:'entity',currency:'USD',accountReference:'account-1'};
  const credit={userId:randomUUID(),amountMinor:'10000',currency:'USD',regulatoryEntityId:'entity',jurisdiction:'US',jurisdictionVersion:1};
  beforeAll(async()=>{
    server=createServer(async(req,res)=>{
      let body='';for await(const chunk of req)body+=chunk;
      calls.push({path:req.url!,authorization:req.headers.authorization,body:body?JSON.parse(body):null});
      if(req.headers.authorization!=='Bearer contract-test-token'){res.writeHead(401).end();return;}
      res.setHeader('content-type','application/json');
      if(req.url==='/capabilities/wallet')res.end(JSON.stringify({version:'LINQASEND_WALLET_V1',custodyBalances:true,custodyReceiptLookup:true,payoutLookupByIdempotencyKey:true}));
      else if(req.url==='/custody/balances/lookup')res.end(JSON.stringify({...JSON.parse(body),snapshotId:'snapshot-1',balanceMinor:'9007199254740993',asOf:new Date().toISOString()}));
      else if(req.url==='/payouts/lookup/redirect'){res.writeHead(302,{location:'/credential-leak'}).end();}
      else if(req.url==='/credential-leak'){redirectHits++;res.end('{}');}
      else if(req.url==='/payouts/lookup/missing')res.end('null');
      else if(req.url==='/payouts/lookup/bad')res.end(JSON.stringify({status:'COMPLETED',providerRef:''}));
      else if(req.url!.startsWith('/payouts/lookup/'))res.end(JSON.stringify({status:'COMPLETED',providerRef:'payout-1'}));
      else if(req.url!.startsWith('/custody/receipts/lookup/'))res.end(JSON.stringify({status:'SETTLED',providerId:'test-provider',transferId:'transfer-1',providerRef:'payout-1',walletCredit:credit}));
      else {res.writeHead(404).end('{}');}
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    base=`http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));});
  it('authenticates balance lookups and preserves amounts beyond JavaScript safe integers',async()=>{
    const p=createHttpLinqaSendProviders(base,'contract-test-token');
    const balance=await p.custody!.getBalance(scope);
    expect(balance.balanceMinor).toBe('9007199254740993');validateCustodyBalance(balance,scope,new Date());
    const call=calls.find(c=>c.path==='/custody/balances/lookup')!;expect(call.body).toEqual(scope);expect(call.authorization).toBe('Bearer contract-test-token');
  });
  it('negotiates custody, receipt and lookup capabilities',async()=>{
    expect(await createHttpLinqaSendProviders(base,'contract-test-token').custody!.capabilities()).toMatchObject({version:'LINQASEND_WALLET_V1',payoutLookupByIdempotencyKey:true});
  });
  it('looks up payout and custody receipt under the same encoded original identity',async()=>{
    const p=createHttpLinqaSendProviders(base,'contract-test-token'),key='deposit:key/one?two';
    expect(await p.payout.lookupByIdempotencyKey!(key)).toMatchObject({providerRef:'payout-1'});
    expect(await p.custody!.lookupReceipt(key)).toMatchObject({walletCredit:credit,status:'SETTLED'});
    expect(calls.some(c=>c.path===`/payouts/lookup/${encodeURIComponent(key)}`)).toBe(true);
    expect(calls.some(c=>c.path===`/custody/receipts/lookup/${encodeURIComponent(key)}`)).toBe(true);
  });
  it('does not turn missing or malformed lookup results into a payout',async()=>{
    const p=createHttpLinqaSendProviders(base,'contract-test-token');
    expect(await p.payout.lookupByIdempotencyKey!('missing')).toBeNull();
    await expect(p.payout.lookupByIdempotencyKey!('bad')).rejects.toThrow();
    expect(calls.some(c=>c.path==='/payouts')).toBe(false);
  });
  it('refuses credential redirects and invalid gateway authentication',async()=>{
    await expect(createHttpLinqaSendProviders(base,'contract-test-token').payout.lookupByIdempotencyKey!('redirect')).rejects.toThrow();
    expect(redirectHits).toBe(0);
    await expect(createHttpLinqaSendProviders(base,'wrong').custody!.capabilities()).rejects.toThrow('linqasend_provider_error:401');
  });
  it('rejects stale, future, wrong-scope and numeric balance observations',()=>{
    const now=new Date(),b={...scope,snapshotId:'s',balanceMinor:'100',asOf:now.toISOString()};
    for(const patch of [{currency:'JPY'},{regulatoryEntityId:'other'},{accountReference:'other'},{providerId:'other'}])expect(()=>validateCustodyBalance({...b,...patch},scope,now)).toThrow('CUSTODY_SCOPE_MISMATCH');
    for(const asOf of [new Date(now.getTime()-300001).toISOString(),new Date(now.getTime()+30001).toISOString()])expect(()=>validateCustodyBalance({...b,asOf},scope,now)).toThrow('CUSTODY_OBSERVATION_STALE_OR_FUTURE');
    expect(()=>validateCustodyBalance({...b,balanceMinor:100 as any},scope,now)).toThrow('CUSTODY_BALANCE_INVALID');
  });
});
