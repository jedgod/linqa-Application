import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LiveSession} from '../clients/mobile/features/conversation/live/LiveSession';
class Events {listeners=new Map<string,((e:any)=>void)[]>();addEventListener(type:string,fn:(e:any)=>void){this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}removeEventListener(){} emit(type:string,e:any={}){for(const fn of this.listeners.get(type)||[])fn(e);}}
class Track extends Events {stopped=false;enabled=true;constructor(public kind:string,public id=kind){super();}stop(){this.stopped=true;}}
class Stream {constructor(public tracks:Track[]){}addTrack(track:Track){this.tracks.push(track);}getTracks(){return this.tracks;}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}}
class Channel extends Events {readyState='open';bufferedAmount=0;sent:string[]=[];closed=false;send(data:string){this.sent.push(data);}close(){this.closed=true;this.readyState='closed';}}
class Peer extends Events {static last:Peer;channel=new Channel();closed=false;added:any[]=[];candidates:any[]=[];remoteDescription:any=null;localDescription:any=null;signalingState='stable';connectionState='new';constructor(){super();Peer.last=this;}createDataChannel(){return this.channel;}addTrack(t:any){this.added.push(t);return {track:t};}removeTrack(){}async addIceCandidate(c:any){this.candidates.push(c);}async setRemoteDescription(d:any){this.remoteDescription=d;}async setLocalDescription(){this.localDescription={toJSON:()=>({type:'answer',sdp:'answer'})};}close(){this.closed=true;}restartIce(){} }
class Description {type:string;constructor(public data:any){this.type=data.type;} }
function fixture(media?:Promise<Stream>, display?:Promise<Stream>,send?:()=>Promise<any>){const local=new Stream([new Track('audio'),new Track('video')]);const screen=new Stream([new Track('video','screen')]);const sent:any[]=[];
  const rtc={RTCPeerConnection:Peer,RTCSessionDescription:Description,RTCIceCandidate:Description,MediaStream:Stream,mediaDevices:{getUserMedia:()=>media??Promise.resolve(local),getDisplayMedia:()=>display??Promise.resolve(screen)}};
  const session=new LiveSession({sessionId:'s',conversationId:'chat',selfId:'a',peerId:'b',iceServers:[],transport:{sendContent:async(_chat,c)=>{sent.push(c);return send?send():{id:'id',sentAt:'now'};}}},rtc as never);
  return {session,peer:Peer.last,local,screen,sent,rtc};
}
test('call termination immediately closes tracks and transport even if hangup cannot send',async()=>{
 const f=fixture(undefined,undefined,()=>new Promise(()=>{}));await f.session.start();await f.session.startScreenShare();await f.session.end();
 assert.ok(f.local.tracks.every(t=>t.stopped));assert.ok(f.screen.tracks.every(t=>t.stopped));assert.equal(f.peer.closed,true);assert.equal(f.peer.channel.closed,true);assert.equal(f.session.getSnapshot().sharingScreen,false);
 f.peer.connectionState='connected';f.peer.emit('connectionstatechange');assert.equal(f.session.getSnapshot().state,'ended');
});
test('a media permission result arriving after leaving is stopped and never attached',async()=>{
 let resolve!:(s:Stream)=>void;const pending=new Promise<Stream>(r=>resolve=r);const f=fixture(pending);const starting=f.session.start();await f.session.end(false);resolve(f.local);await starting;
 assert.ok(f.local.tracks.every(t=>t.stopped));assert.equal(f.peer.added.length,0);
});
test('signals accept only the matching session and peer, with a bounded ICE queue',async()=>{
 const f=fixture();const hangup={type:'rtc_signal' as const,sessionId:'s',signal:{kind:'hangup' as const}};
 await f.session.handleSignal(hangup,'intruder');await f.session.handleSignal({...hangup,sessionId:'other'},'b');assert.equal(f.session.getSnapshot().state,'connecting');
 for(let i=0;i<300;i++)await f.session.handleSignal({type:'rtc_signal',sessionId:'s',signal:{kind:'candidate',candidate:{candidate:String(i)}}},'b');
 await f.session.handleSignal({type:'rtc_signal',sessionId:'s',signal:{kind:'description',sdp:{type:'offer',sdp:'test'}}},'b');assert.equal(f.peer.candidates.length,256);
 assert.equal(f.sent[0].type,'rtc_signal');await f.session.handleSignal(hangup,'b');assert.equal(f.session.getSnapshot().state,'ended');
});
test('screen permission completion after hangup is cleaned up',async()=>{
 let resolve!:(s:Stream)=>void;const pending=new Promise<Stream>(r=>resolve=r);const f=fixture(undefined,pending);const starting=f.session.startScreenShare();await f.session.end(false);resolve(f.screen);
 assert.equal(await starting,false);assert.ok(f.screen.tracks.every(t=>t.stopped));
});
test('data channel rejects excessive buffering and stops accepting after hangup',async()=>{
 const f=fixture();const message={t:'lock' as const,locked:true,by:'a'};f.peer.channel.bufferedAmount=1000001;assert.equal(f.session.send(message),false);
 f.peer.channel.bufferedAmount=0;assert.equal(f.session.send(message),true);let received=0;f.session.onWire(()=>received++);f.peer.channel.emit('message',{data:JSON.stringify(message)});assert.equal(received,1);
 await f.session.end(false);f.peer.channel.emit('message',{data:JSON.stringify(message)});assert.equal(received,1);assert.equal(f.session.send(message),false);
});
test('unanswered calls time out and release acquired media',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();await f.session.start();t.mock.timers.tick(60001);
 assert.equal(f.session.getSnapshot().state,'ended');assert.ok(f.local.tracks.every(track=>track.stopped));
});
test('network recovery clears the deadline, while prolonged disconnection closes the call',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();await f.session.start();f.peer.connectionState='connected';f.peer.emit('connectionstatechange');t.mock.timers.tick(60001);assert.equal(f.session.getSnapshot().state,'connected');
 f.peer.connectionState='disconnected';f.peer.emit('connectionstatechange');t.mock.timers.tick(30001);assert.equal(f.session.getSnapshot().state,'ended');assert.ok(f.local.tracks.every(track=>track.stopped));
});
test('an audio-only call acquires a camera only after an explicit enable action',async()=>{
 const f=fixture();f.local.tracks=f.local.tracks.filter(t=>t.kind==='audio');await f.session.start();assert.equal(f.session.getSnapshot().cameraOn,false);
 const camera=new Track('video','new-camera');f.rtc.mediaDevices.getUserMedia=()=>Promise.resolve(new Stream([camera]));
 assert.equal(await f.session.setCamera(true),true);assert.equal(f.session.getSnapshot().cameraOn,true);assert.ok(f.peer.added.includes(camera));
 await f.session.end(false);assert.equal(camera.stopped,true);assert.equal(await f.session.setCamera(true),false);
});
test('a camera permission result arriving after hangup is immediately stopped',async()=>{
 const f=fixture();f.local.tracks=f.local.tracks.filter(t=>t.kind==='audio');await f.session.start();let release!:(s:Stream)=>void;
 f.rtc.mediaDevices.getUserMedia=()=>new Promise<Stream>(resolve=>release=resolve);const enabling=f.session.setCamera(true);await f.session.end(false);
 const track=new Track('video');release(new Stream([track]));assert.equal(await enabling,false);assert.equal(track.stopped,true);assert.equal(f.session.getSnapshot().cameraOn,false);
});
