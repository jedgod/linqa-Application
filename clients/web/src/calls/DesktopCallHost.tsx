import {createContext,useContext,useEffect,useState,useRef,type ReactNode} from 'react';
import {CallManager,type ManagerState} from './rooms/CallManager';
import {CallEngine,type EngineState} from './rooms/CallEngine';
import {LinqaCallCrypto} from './rooms/crypto/LinqaCallCrypto';
import {DesktopKeyDirectory} from './rooms/keyDirectory';
import {streams} from './rooms/browserRtc';
import {callApi} from './rooms/callApi';
import type {CallSession,CallCrypto} from './rooms/ports';
import type {DeviceInfo} from './rooms/protocol';
import type {ChatRuntime} from '../chat/useLinkedChat';
import {Dialog} from '../chat/ChatDialogs';
import {getApiBaseUrl} from '../app/apiSession';
import {downloadBlob} from '../chat/features/files';
import {LocalTranscription} from '../voice/LocalTranscription';
type Ready=Extract<ChatRuntime,{status:'ready'}>;
const Context=createContext<{manager:CallManager|null;start:(conversationId:string,kind:'voice'|'video',users:string[])=>Promise<void>}>({manager:null,start:async()=>{throw Error('Call service is starting.');}});
export const useDesktopCalls=()=>useContext(Context);
export function DesktopCallHost({runtime,children}:{runtime:Ready;children:ReactNode}){
 const [manager,setManager]=useState<CallManager|null>(null),[state,setState]=useState<ManagerState|null>(null),[error,setError]=useState('');
 const names=useRef(new Map<string,string>());
 useEffect(()=>{
  const core=runtime.core;
  const binding={seal:(r:import('./rooms/crypto/linqaCore').DevicePublicKeys,p:Uint8Array,a:Uint8Array)=>core.sealCallKey(r.x25519,r.mlkem768,p,a),open:(s:Uint8Array,a:Uint8Array)=>core.openCallKey(s,a),sign:(m:Uint8Array)=>core.signCallMessage(m)};
  const callCrypto:CallCrypto=new LinqaCallCrypto(binding,new DesktopKeyDirectory(core,runtime.api),{userId:runtime.userId,deviceId:runtime.deviceId});
  const session:CallSession={apiBaseUrl:getApiBaseUrl(),getToken:runtime.getToken,userId:runtime.userId,deviceId:runtime.deviceId,deviceName:'Linked computer',platform:'web'};
  const made=new CallManager(session,callCrypto);setManager(made);const off=made.subscribe(setState);
  void runtime.api.inbox().then(result=>{for(const c of result)if(c.peerUserId)names.current.set(c.peerUserId,c.title);}).catch(()=>undefined);
  return()=>{off();made.dispose();streams.clear();};
 },[runtime]);
 const start=async(conversationId:string,kind:'voice'|'video',users:string[])=>{if(!manager)throw Error('Call service is starting.');try{setError('');await manager.startCall(conversationId,kind,users);}catch(e){const message=e instanceof Error?e.message:'Could not start the call.';setError(message);throw e;}};
 const act=(fn:()=>Promise<unknown>)=>{void fn().catch(e=>setError(e instanceof Error?e.message:'Call action failed.'));};
 return <Context.Provider value={{manager,start}}>{children}
 {error?<div className="lc-note-bar" role="alert">{error}<button onClick={()=>setError('')}>Dismiss</button></div>:null}
 {state?.incoming?<Dialog title="Incoming call" onClose={()=>act(()=>manager!.decline())}><p>{names.current.get(state.incoming.fromUserId)??'Linqa contact'} is calling ({state.incoming.kind}).</p><div className="lc-feature-actions"><button className="lc-btn lc-btn-primary" disabled={state.busy} onClick={()=>act(()=>manager!.answer())}>Answer</button><button className="lc-btn" onClick={()=>act(()=>manager!.decline())}>Decline</button></div></Dialog>:null}
 {state?.incomingHandoff?<Dialog title="Switch call to this computer" onClose={()=>act(()=>manager!.declineHandoff())}><button className="lc-btn lc-btn-primary" onClick={()=>act(()=>manager!.acceptHandoff())}>Continue here</button></Dialog>:null}
 {state?.engine?<CallWindow engine={state.engine} runtime={runtime} manager={manager!} name={id=>names.current.get(id)??'Linqa contact'}/>:null}
 </Context.Provider>;
}
function Video({id,muted=false,label}:{id:string|null;muted?:boolean;label:string}){
 const ref=useRef<HTMLVideoElement>(null);
 useEffect(()=>{const v=ref.current;if(!v)return;v.srcObject=id?streams.get(id)??null:null;if(v.srcObject)void v.play().catch(()=>undefined);return()=>{v.srcObject=null;};},[id]);
 return <figure className="lc-call-video"><video ref={ref} autoPlay playsInline muted={muted}/><figcaption>{label}</figcaption></figure>;
}
function CallWindow({engine,runtime,manager,name}:{engine:CallEngine;runtime:Ready;manager:CallManager;name:(id:string)=>string}){
 const [state,setState]=useState<EngineState>(engine.state),[error,setError]=useState(''),[tools,setTools]=useState(false),[devices,setDevices]=useState<DeviceInfo[]>([]),[info,setInfo]=useState(''),[recording,setRecording]=useState(false),[transcribing,setTranscribing]=useState(false),[transcript,setTranscript]=useState(''),[color,setColor]=useState('#4CD3A5');
 const recorder=useRef<MediaRecorder|null>(null),chunks=useRef<Blob[]>([]),speech=useRef(new LocalTranscription()),stroke=useRef<string|null>(null),preview=useRef<globalThis.MediaStream|null>(null),recordingStream=useRef<globalThis.MediaStream|null>(null);
 const act=(fn:()=>Promise<unknown>)=>{void fn().catch(e=>setError(e instanceof Error?e.message:'Call action failed.'));};
 const stopRecording=()=>{const r=recorder.current;recorder.current=null;if(r&&r.state!=='inactive')r.stop();setRecording(false);};
 useEffect(()=>engine.subscribe(setState),[engine]);
 useEffect(()=>{if(state.status==='ended'){stopRecording();speech.current.stop();setTranscribing(false);}},[state.status]);
 useEffect(()=>()=>{const r=recorder.current;if(r&&r.state!=='inactive')r.stop();speech.current.stop();preview.current?.getTracks().forEach(t=>t.stop());},[]);
 const record=()=>{
  if(recording){stopRecording();return;}const track=engine.microphoneStream().getAudioTracks()[0];if(!track)throw Error('Microphone unavailable.');
  const own=new globalThis.MediaStream([track.clone()]);recordingStream.current=own;chunks.current=[];const r=new MediaRecorder(own);recorder.current=r;
  let size=0;const limit=setTimeout(()=>stopRecording(),3600000);
  r.ondataavailable=e=>{if(e.data.size){chunks.current.push(e.data);size+=e.data.size;if(size>=25*1024*1024&&r.state!=='inactive')stopRecording();}};
  r.onstop=()=>{clearTimeout(limit);const blob=new Blob(chunks.current,{type:r.mimeType});const extension=r.mimeType.includes('mp4')?'.m4a':r.mimeType.includes('ogg')?'.ogg':'.webm';if(blob.size)downloadBlob(blob,'Linqa-my-microphone-'+Date.now()+extension);chunks.current=[];own.getTracks().forEach(t=>t.stop());recordingStream.current=null;};
  r.onerror=()=>{clearTimeout(limit);own.getTracks().forEach(t=>t.stop());setError('Recording failed.');setRecording(false);};
  try{r.start(1000);setRecording(true);}catch(error){clearTimeout(limit);own.getTracks().forEach(t=>t.stop());recorder.current=null;throw error;}
 };
 const transcribe=async()=>{if(transcribing){speech.current.stop();setTranscribing(false);return;}await speech.current.start(text=>setTranscript(old=>(old+' '+text).trim().slice(-100000)),setError);setTranscribing(true);};
 const add=async()=>{const r=await runtime.api.inbox();const ids=[...new Set(r.flatMap(c=>c.peerUserId?[c.peerUserId]:[]))].filter(id=>!Object.values(state.peers).some(p=>p.userId===id));const chosen=ids.length?window.prompt('Enter the name of a contact to add:\n'+ids.map(name).join('\n')):null;const id=ids.find(id=>name(id).toLowerCase()===chosen?.trim().toLowerCase());if(chosen&&!id)throw Error('Choose a listed contact.');if(id)await engine.addPeople([id]);};
 const active=state.status!=='ended';
 return <Dialog title={state.kind==='video'?'Video call':'Voice call'} wide onClose={()=>act(()=>engine.hangUp())}>
 <p className="lc-dialog-note">{state.status}{state.connectedAt?' ? '+Math.floor((Date.now()-state.connectedAt)/1000)+' seconds':''}</p>
 <div className="lc-call-grid"><Video id={state.self.previewUrl} muted label="You"/>{Object.values(state.peers).map(p=><Video key={p.participantId} id={p.streamUrl} label={name(p.userId)+(p.handRaisedAt?' ? Hand raised':'')}/>)}</div>
 <div className="lc-feature-actions"><button className="lc-btn" disabled={!active} onClick={()=>engine.setMuted(!state.self.muted)}>{state.self.muted?'Unmute':'Mute'}</button><button className="lc-btn" disabled={!active} onClick={()=>act(()=>engine.setCamera(!state.self.cameraOn))}>{state.self.cameraOn?'Camera off':'Camera on'}</button><button className="lc-btn" disabled={!active||!navigator.mediaDevices?.getDisplayMedia} onClick={()=>act(()=>state.self.sharingScreen?engine.stopScreenShare():engine.startScreenShare())}>{state.self.sharingScreen?'Stop sharing':'Share screen'}</button><button className="lc-btn" disabled={!active} onClick={()=>state.board.open?engine.closeBoard():engine.openBoard()}>Whiteboard</button><button className="lc-btn" disabled={!active} onClick={()=>act(()=>engine.toggleHand())}>Raise hand</button><button className="lc-btn" onClick={()=>setTools(v=>!v)}>Tools & menu</button><button className="lc-btn" disabled={!active} onClick={()=>act(async()=>record())}>{recording?'Stop recording':'Record my microphone'}</button><button className="lc-btn lc-btn-primary" onClick={()=>act(()=>engine.hangUp())}>End call</button></div>
 {tools?<div className="lc-feature-actions"><button className="lc-btn" onClick={()=>act(add)}>Add person</button><button className="lc-btn" onClick={()=>act(async()=>setDevices(await engine.listOtherDevices()))}>Switch device</button><button className="lc-btn" onClick={()=>act(async()=>{const r=await callApi.info(manager.session,state.callId);const code=await engine.verificationCode();setInfo(`${r.participantCount} participants ? ${Math.round(r.durationMs/1000)} seconds ? Verification: ${code??'unavailable'}`);})}>Call info</button><button className="lc-btn" disabled={!active} onClick={()=>act(transcribe)}>{transcribing?'Stop transcript':'My live transcript'}</button><button className="lc-btn" onClick={()=>act(async()=>{await LocalTranscription.install();setInfo('English language pack installed.');})}>Install transcription language</button><button className="lc-btn" onClick={()=>{const ids=[...new Set(Object.values(state.peers).map(p=>p.userId))];if(ids.length&&window.confirm('Report the other participants for unwanted behavior?'))act(()=>callApi.report(manager.session,state.callId,{reportedUserIds:ids,reason:'other'}));}}>Report</button></div>:null}
 {devices.map(d=><button key={d.deviceId} className="lc-btn" onClick={()=>act(()=>engine.switchTo(d.deviceId))}>{d.name}</button>)}
 {state.handoff?<button className="lc-btn" onClick={()=>act(()=>engine.cancelSwitch())}>Cancel device switch</button>:null}
 {info?<p className="lc-dialog-note">{info}</p>:null}{error?<p role="alert">{error}</p>:null}
 {transcript?<><textarea aria-label="My transcript" value={transcript} onChange={e=>setTranscript(e.target.value)}/><button className="lc-btn" onClick={()=>downloadBlob(new Blob([transcript],{type:'text/plain'}),'Linqa-transcript.txt')}>Save transcript</button></>:null}
 {state.board.open?<><div className="lc-feature-actions"><input type="color" aria-label="Drawing color" value={color} onChange={e=>setColor(e.target.value)}/><button className="lc-btn" onClick={()=>engine.undoStroke()}>Undo</button><button className="lc-btn" onClick={()=>engine.clearBoard()}>Clear</button></div><svg className="lc-call-board" viewBox="0 0 1000 600" style={{background:state.board.bg??'#12181d',touchAction:'none'}} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);stroke.current=crypto.randomUUID();const r=e.currentTarget.getBoundingClientRect();engine.drawPoints(stroke.current,color,.004,[(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height]);}} onPointerMove={e=>{if(!stroke.current)return;const r=e.currentTarget.getBoundingClientRect();engine.drawPoints(stroke.current,color,.004,[(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height]);}} onPointerUp={()=>{if(stroke.current)engine.finishStroke(stroke.current);stroke.current=null;}} onPointerCancel={()=>{if(stroke.current)engine.finishStroke(stroke.current);stroke.current=null;}}>{state.board.strokes.map(s=><polyline key={s.id} points={s.points.reduce((p,v,i)=>p+(i%2?',':' ')+(v*(i%2?600:1000)), '')} fill="none" stroke={s.color} strokeWidth={s.width*1000} strokeLinecap="round" strokeLinejoin="round"/>)}</svg></>:null}
 <p className="lc-dialog-note">Recording and local transcription capture your microphone. Recordings download to this computer.</p>
 </Dialog>;
}
