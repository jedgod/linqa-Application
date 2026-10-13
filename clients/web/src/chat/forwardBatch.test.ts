import {expect,it,vi} from 'vitest';
import {ForwardBatch} from '../../../mobile/services/forward-batch';
it('partial retries skip successful chats and reuse the exact sealed payload and message ID',async()=>{
 let id=0,fail=true;const prepare=vi.fn(async(target:string,messageId:string)=>target+':'+messageId);
 const deliver=vi.fn(async(target:string)=>{if(target==='second'&&fail)throw Error('offline');});
 const batch=new ForwardBatch(()=>String(++id),prepare,deliver);
 expect(await batch.send(['first','second'])).toEqual(['second']);fail=false;
 expect(await batch.send(['first','second'])).toEqual([]);expect(prepare).toHaveBeenCalledTimes(2);
 expect(deliver.mock.calls.map(args=>args[0])).toEqual(['first','second','second']);
 expect(deliver.mock.calls[1]).toEqual(deliver.mock.calls[2]);
});
it('concurrent forwarding of the same selection submits each target once and enforces five targets',async()=>{
 let release!:()=>void;const wait=new Promise<void>(resolve=>release=resolve);const deliver=vi.fn(async()=>{await wait;});
 const batch=new ForwardBatch(()=>crypto.randomUUID(),async()=> 'sealed',deliver);
 const a=batch.send(['one','one']),b=batch.send(['one']);release();await Promise.all([a,b]);expect(deliver).toHaveBeenCalledTimes(1);
 await expect(batch.send(['1','2','3','4','5','6'])).rejects.toThrow('INVALID_FORWARD_TARGETS');
});
