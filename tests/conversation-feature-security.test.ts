import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateContent,encodeContent,decodeContent} from '../clients/mobile/features/conversation/content/codec';
import {WireAssembler} from '../clients/mobile/features/conversation/live/WireAssembler';
import {Board} from '../clients/mobile/features/conversation/whiteboard/model';
const file = {type:'file' as const,fileKind:'image' as const,name:'image.png',mime:'image/png',size:12,blobId:'00000000-0000-4000-8000-000000000001',key:'A'.repeat(43)+'=',nonce:'A'.repeat(32),sha256:'a'.repeat(64)};
test('encrypted file descriptors reject unsafe paths, missing keys and oversized files',()=>{
  assert.deepEqual(validateContent(file),file);
  for (const extra of [{name:'../secret.png'},{name:'a\\b.png'},{size:0},{size:26*1024*1024},{key:'short'},{nonce:'wrong'},{blobId:'path'},{mime:'text/html'},{width:Infinity},{waveform:[NaN]}]) {
    assert.equal(validateContent({...file,...extra}),null,JSON.stringify(extra));
  }
  assert.throws(()=>encodeContent({...file,key:'short'}));
  assert.equal(decodeContent(JSON.stringify({v:2,c:file})),null);
});
test('RTC and vote descriptors reject excessive or ambiguous controls',()=>{
  assert.equal(validateContent({type:'poll_vote',pollId:'p',optionIds:['a','a']}),null);
  assert.equal(validateContent({type:'rtc_signal',sessionId:'s',signal:{kind:'candidate',candidate:{candidate:'a'.repeat(9000)}}}),null);
  assert.equal(validateContent({type:'live_session',sessionId:'s',state:'started',screenShare:'yes'}),null);
});
test('wire chunks assemble out of order and expire incomplete messages',()=>{
  const a=new WireAssembler(); const data=JSON.stringify({t:'sync',layer:'board',els:[]}); const split=12;
  const chunk=(id:string,i:number,d:string)=>JSON.stringify({t:'chunk',id,i,n:2,d});
  assert.equal(a.accept(chunk('a',1,data.slice(split)),0),null);
  assert.deepEqual(a.accept(chunk('a',0,data.slice(0,split)),1),JSON.parse(data));
  a.accept(chunk('b',0,data.slice(0,split)),1);
  assert.equal(a.accept(chunk('b',1,data.slice(split)),31002),null);
  assert.equal(a.accept(JSON.stringify({t:'chunk',id:'x',i:0,n:257,d:''})),null);
  assert.equal(a.accept(JSON.stringify({t:'chunk',id:'x',i:0,n:1,d:JSON.stringify({t:'chunk'})})),null);
});
test('wire assembly rejects duplicate parts and bounds concurrent messages',()=>{
  const a=new WireAssembler(); const part=(id:string)=>JSON.stringify({t:'chunk',id,i:0,n:2,d:'{'});
  for(let i=0;i<4;i++) assert.equal(a.accept(part(String(i)),0),null);
  assert.equal(a.accept(part('overflow'),0),null);
  a.clear(); assert.equal(a.accept(part('a'),0),null); assert.equal(a.accept(part('a'),1),null);
  assert.equal(a.accept(JSON.stringify({t:'chunk',id:'a',i:1,n:2,d:'}'}),2),null);
});
test('full-board sync enforces peer identity and the edit lock',()=>{
  const source=new Board('peer'); source.add({id:'shape',kind:'rect',x1:0,y1:0,x2:10,y2:10,color:'#000000',width:2});
  const dest=new Board('self'); dest.receiveSync(source.snapshot(),'intruder'); assert.equal(dest.elements().length,0);
  dest.receiveSync(source.snapshot(),'peer',()=>false); assert.equal(dest.elements().length,0);
  dest.receiveSync(source.snapshot(),'peer'); assert.equal(dest.elements().length,1);
});
test('reconnect tombstones prevent deleted elements from reappearing',()=>{
  const source=new Board('peer'); source.add({id:'shape',kind:'rect',x1:0,y1:0,x2:10,y2:10,color:'#000000',width:2});
  const previous=source.snapshot(); const dest=new Board('self');
  dest.receiveGraves([{id:'shape',clock:{c:20,a:'peer'}}],'peer'); dest.receiveSync(previous,'peer');
  assert.equal(dest.elements().length,0);
});

