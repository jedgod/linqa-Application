import {createContext,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {Dialog} from '../ChatDialogs';
import type {ChatRuntime} from '../useLinkedChat';
import {DesktopFiles,downloadBlob,MAX_FILE_BYTES} from './files';
import type {FileContent,EventContent,MeetingContent} from './types';
import {validateContent} from './codec';
import {VoiceNoteRecorder} from '../../voice/VoiceNoteRecorder';
import {FileVaultClient,type VaultItemSummary} from '../../vault/FileVaultClient';
import {getApiBaseUrl} from '../../app/apiSession';
import {useDesktopCalls} from '../../calls/DesktopCallHost';
export type DesktopFeature='attachments'|'photos'|'voice'|'location'|'contact'|'events'|'meetings'|'gif'|'ai'|'vault'|'voice-call'|'video-call'|'whiteboard'|'recording';
type Ready=Extract<ChatRuntime,{status:'ready'}>;
export const FeatureThreadContext=createContext<{runtime:Ready;conversationId:string;send:(payload:object,label:string)=>Promise<void>}|null>(null);
export function desktopFeature(payload:unknown):Record<string,unknown>|null{
 if(!payload||typeof payload!=='object')return null;const p=payload as Record<string,unknown>;
 if(p.type==='feature'&&validateContent(p.content))return p.content as unknown as Record<string,unknown>;
 if(p.v===1&&validateContent(p.c))return p.c as unknown as Record<string,unknown>;
 if(p.type==='location')return typeof p.latitude==='number'&&Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&typeof p.longitude==='number'&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180?p:null;
 if(p.type==='contact')return typeof p.title==='string'?p:null;
 if(p.type==='event'||p.type==='meeting')return typeof p.title==='string'&&typeof p.startsAt==='string'&&Number.isFinite(Date.parse(p.startsAt))?p:null;
 if(p.type==='media')return typeof p.mediaId==='string'&&/^[0-9a-f-]{36}$/i.test(p.mediaId)&&typeof p.mediaKey==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(p.mediaKey)&&typeof p.mimeType==='string'&&/^(image\/(gif|jpeg|png|webp)|audio\/(mp4|aac|mpeg|x-m4a)|video\/(mp4|quicktime))$/.test(p.mimeType)?p:null;
 return null;
}
export function DesktopMessage({raw,text,sender}:{raw?:string;text:string;sender?:string}){
 const context=useContext(FeatureThreadContext);let content:Record<string,unknown>|null=null;
 try{content=raw?desktopFeature(JSON.parse(raw)):null;}catch{}
 if(!content||!context)return <p>{text}</p>;
 if(content.type==='file')return <FileMessage file={content as unknown as FileContent}/>;
 if(content.type==='media'&&sender)return <LegacyMedia content={content} sender={sender}/>;
 if(content.type==='location')return <div className="lc-feature-card"><strong>Location ? {String(content.label??content.title??'Shared location')}</strong><p>{String(content.address??'')}</p><a href={`https://www.google.com/maps/search/?api=1&query=${Number(content.latitude)},${Number(content.longitude)}`} target="_blank" rel="noopener noreferrer">Open map</a></div>;
 if(content.type==='contact')return <div className="lc-feature-card"><strong>{String(content.name??content.title??'Contact')}</strong><p>{String(content.organization??content.role??'')}</p>{Array.isArray(content.phones)?content.phones.map((p:any,i)=><p key={i}>{String(p.number??'')}</p>):<p>{String(content.phone??content.handle??'')}</p>}</div>;
 if(content.type==='event'||content.type==='meeting')return <ScheduleMessage content={content} context={context}/>;
 return <p>{text}</p>;
}
function LegacyMedia({content,sender}:{content:Record<string,unknown>;sender:string}){
 const ctx=useContext(FeatureThreadContext)!;const [url,setUrl]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const held=useRef<string|null>(null);const live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;if(held.current)URL.revokeObjectURL(held.current);};},[]);
 const open=async()=>{setBusy(true);try{const blob=await new DesktopFiles(ctx.runtime.api,ctx.conversationId).openLegacy(sender,content as unknown as {mediaId:string;mediaKey:string;mimeType:string;mediaDigest?:string});if(!live.current)return;if(held.current)URL.revokeObjectURL(held.current);held.current=URL.createObjectURL(blob);setUrl(held.current);}catch(e){if(live.current)setError(String(e));}finally{if(live.current)setBusy(false);}};
 const mime=String(content.mimeType);
 return <div className="lc-feature-card"><strong>{String(content.caption??content.mediaKind??'Media')}</strong>{url?mime.startsWith('image/')?<img className="lc-chat-image" src={url} alt={String(content.caption??'Photo')}/>:mime.startsWith('audio/')?<audio src={url} controls/>:<video className="lc-chat-image" src={url} controls playsInline/>:<button className="lc-btn" disabled={busy} onClick={()=>void open()}>{busy?'Opening?':'Open media'}</button>}{error?<p role="alert">{error}</p>:null}</div>;
}
function FileMessage({file}:{file:FileContent}){
 const context=useContext(FeatureThreadContext)!;const files=useMemo(()=>new DesktopFiles(context.runtime.api,context.conversationId),[context.runtime.api,context.conversationId]);
 const [url,setUrl]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const held=useRef<string|null>(null);const live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;if(held.current)URL.revokeObjectURL(held.current);};},[]);
 const open=async()=>{if(busy)return;setBusy(true);setError('');try{const blob=await files.open(file);if(!live.current)return;if(['image','video','voice'].includes(file.fileKind)){if(held.current)URL.revokeObjectURL(held.current);held.current=URL.createObjectURL(blob);setUrl(held.current);}else downloadBlob(blob,file.name);}catch(e){if(live.current)setError(e instanceof Error?e.message:'Could not open file.');}finally{if(live.current)setBusy(false);}};
 return <div className="lc-feature-card"><strong>{file.name}</strong><p>{Math.ceil(file.size/1024)} KB{file.caption?' ? '+file.caption:''}</p>{url&&file.fileKind==='image'?<img className="lc-chat-image" src={url} alt={file.caption??file.name}/>:url&&file.fileKind==='video'?<video className="lc-chat-image" src={url} controls playsInline/>:url&&file.fileKind==='voice'?<audio src={url} controls/>:null}<button className="lc-btn" disabled={busy} onClick={()=>void open()}>{busy?'Opening?':url?'Open again':file.fileKind==='document'?'Download':'Open'}</button>{url?<button className="lc-btn" onClick={()=>{const a=document.createElement('a');a.href=url;a.download=file.name;a.click();}}>Save</button>:null}{error?<p role="alert">{error}</p>:null}</div>;
}
const esc=(s:string)=>s.replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
export function calendarFile(c:EventContent|MeetingContent):string{
 const stamp=(d:string)=>new Date(d).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const end=c.type==='event'?c.endsAt:new Date(Date.parse(c.startsAt)+c.durationMin*60000).toISOString();
 return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Linqa//Calendar//EN','BEGIN:VEVENT','UID:'+(c.type==='event'?c.eventId:c.meetingId)+'@linqa','DTSTAMP:'+stamp(new Date().toISOString()),'DTSTART:'+stamp(c.startsAt),'DTEND:'+stamp(end),'SUMMARY:'+esc(c.title),...(c.type==='event'&&c.place?['LOCATION:'+esc(c.place)]:[]),'END:VEVENT','END:VCALENDAR',''].join('\r\n');
}
function ScheduleMessage({content:c,context}:{content:Record<string,unknown>;context:NonNullable<React.ContextType<typeof FeatureThreadContext>>}){
 const calls=useDesktopCalls();const [error,setError]=useState('');
 const title=String(c.title??'Event'),startsAt=String(c.startsAt??'');const typed=c.type==='event'?{type:'event' as const,eventId:String(c.eventId??crypto.randomUUID()),title,startsAt,endsAt:String(c.endsAt??new Date(Date.parse(startsAt)+3600000).toISOString()),place:String(c.place??'')}:{type:'meeting' as const,meetingId:String(c.meetingId??crypto.randomUUID()),title,startsAt,durationMin:Number(c.durationMin??c.durationMinutes??30)};
 return <div className="lc-feature-card"><strong>{c.type==='meeting'?'Meeting':'Event'} ? {title}</strong><p>{new Date(startsAt).toLocaleString()}</p><button className="lc-btn" onClick={()=>downloadBlob(new Blob([calendarFile(typed)],{type:'text/calendar'}),'Linqa-event.ics')}>Add to calendar</button>{c.type==='event'&&c.eventId?<button className="lc-btn" onClick={()=>void context.send({type:'feature',content:{type:'event_rsvp',eventId:c.eventId,response:'going'}},'Going').catch(e=>setError(String(e)))}>Going</button>:null}{c.type==='meeting'?<button className="lc-btn" onClick={()=>void calls.start(context.conversationId,'video',context.runtime.peers.current.get(context.conversationId)??[]).catch(e=>setError(String(e)))}>Join meeting</button>:null}{error?<p role="alert">{error}</p>:null}</div>;
}
export function DesktopFeatureDialog({mode,runtime,conversationId,onSend,onClose}:{mode:DesktopFeature;runtime:Ready;conversationId:string;onSend:(payload:object,label:string)=>Promise<void>;onClose:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[title,setTitle]=useState(''),[secondary,setSecondary]=useState(''),[latitude,setLatitude]=useState(''),[longitude,setLongitude]=useState(''),[start,setStart]=useState(''),[duration,setDuration]=useState(30),[recording,setRecording]=useState(false),[aiText,setAiText]=useState(''),[aiResult,setAiResult]=useState('');
 const recorder=useRef(new VoiceNoteRecorder()),live=useRef(true);const files=useMemo(()=>new DesktopFiles(runtime.api,conversationId),[runtime.api,conversationId]);
 useEffect(()=>()=>{live.current=false;recorder.current.cancel();},[]);
 const run=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){if(live.current)setError(e instanceof Error?e.message:'Could not complete this action.');}finally{if(live.current)setBusy(false);}};
 const upload=async(file:File,details:{durationMs?:number}={})=>{const content=await files.upload(file,details);if(!live.current)return;await onSend({type:'feature',content},content.name);if(live.current)onClose();};
 const form=async()=>{
  let content:object;
  if(mode==='location'){const lat=Number(latitude),lon=Number(longitude);if(!latitude.trim()||!longitude.trim()||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw Error('Enter valid latitude and longitude.');content={type:'location',label:title||'Shared location',latitude:lat,longitude:lon,address:secondary||undefined};}
  else if(mode==='contact'){if(!title.trim()||!/^\+?[0-9 () .-]{3,40}$/.test(secondary))throw Error('Enter a name and valid phone number.');content={type:'contact',name:title.trim(),phones:[{number:secondary}]};}
  else{const startsAt=new Date(start).toISOString();if(!title.trim()||title.length>120||duration<1||duration>1440)throw Error('Enter a title, date and duration (1?1440 minutes).');content=mode==='events'?{type:'event',eventId:crypto.randomUUID(),title,startsAt,endsAt:new Date(Date.parse(startsAt)+duration*60000).toISOString(),place:secondary||undefined}:{type:'meeting',meetingId:crypto.randomUUID(),title,startsAt,durationMin:duration};}
  if(!validateContent(content))throw Error('Check the card details.');await onSend({type:'feature',content},title||'Location');onClose();
 };
 const voice=async()=>{if(!recording){await recorder.current.start();if(live.current)setRecording(true);return;}const result=await recorder.current.stop();setRecording(false);await upload(new File([result.blob],'Voice-message-'+Date.now()+(result.blob.type.includes('mp4')?'.m4a':'.webm'),{type:result.blob.type}),{durationMs:result.durationMs});};
 const aiImage=async()=>{if(!aiText.trim()||aiText.length>2000)throw Error('Enter an image prompt up to 2000 characters.');const result=await runtime.api.request<{base64:string;mime:string}[]>(`/v2/chats/${conversationId}/ai-images`,{method:'POST',body:JSON.stringify({prompt:aiText,style:'Photo',consent:true})});const image=result?.[0];if(!image)throw Error('Image generation is not configured on this server.');const b=Uint8Array.from(atob(image.base64),c=>c.charCodeAt(0));await upload(new File([b],'Linqa-AI-image.png',{type:image.mime}));};
 useEffect(()=>{if(!recording)return;const timer=setTimeout(()=>void run(voice),299000);return()=>clearTimeout(timer);},[recording]);
 const titles:Partial<Record<DesktopFeature,string>>={attachments:'Attachments',photos:'Photos and videos',voice:'Voice message',location:'Location card',contact:'Contact card',events:'Plan an event',meetings:'Plan a meeting',gif:'Send a GIF',ai:'Linqa AI'};
 return <Dialog title={titles[mode]??'Linqa tools'} onClose={onClose}>
 {['attachments','photos','gif'].includes(mode)?<><p className="lc-dialog-note">Files are encrypted before upload. Choose a file up to 25 MB.</p><input aria-label="Choose file" type="file" disabled={busy} accept={mode==='photos'?'image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime':mode==='gif'?'image/gif':undefined} onChange={e=>{const file=e.target.files?.[0];if(file)void run(()=>upload(file));}}/></>:null}
 {mode==='voice'?<><p className="lc-dialog-note">Record your microphone, then stop and send. Closing cancels the recording.</p><button className="lc-btn lc-btn-primary" disabled={busy} onClick={()=>void run(voice)}>{busy?'Working?':recording?'Stop and send':'Start recording'}</button></>:null}
 {['location','contact','events','meetings'].includes(mode)?<form className="lc-feature-form" onSubmit={e=>{e.preventDefault();void run(form);}}><label>{mode==='location'?'Location label':'Name or title'}<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={120} required={mode!=='location'}/></label>{mode==='location'?<><label>Latitude<input value={latitude} onChange={e=>setLatitude(e.target.value)} required/></label><label>Longitude<input value={longitude} onChange={e=>setLongitude(e.target.value)} required/></label><button type="button" className="lc-btn" disabled={busy} onClick={()=>{if(!navigator.geolocation){setError('Location unavailable.');return;}navigator.geolocation.getCurrentPosition(p=>{if(live.current){setLatitude(String(p.coords.latitude));setLongitude(String(p.coords.longitude));}},()=>setError('Location permission was declined.'),{timeout:10000,maximumAge:0});}}>Use my current location</button></>:null}{mode!=='meetings'?<label>{mode==='contact'?'Phone number':mode==='location'?'Address':'Place'}<input value={secondary} onChange={e=>setSecondary(e.target.value)} maxLength={300} required={mode==='contact'}/></label>:null}{['events','meetings'].includes(mode)?<><label>Starts at<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)} required/></label><label>Duration in minutes<input type="number" min={1} max={1440} value={duration} onChange={e=>setDuration(Number(e.target.value))} required/></label></>:null}<button className="lc-btn lc-btn-primary" disabled={busy}>{busy?'Sending?':'Send card'}</button></form>:null}
 {mode==='ai'?<><p className="lc-dialog-note">Summarize text locally, or generate an image using the configured image service. Only Generate image sends your prompt to that service.</p><textarea aria-label="Text or image prompt" value={aiText} onChange={e=>setAiText(e.target.value)} maxLength={8000}/><div className="lc-feature-actions"><button className="lc-btn" onClick={()=>setAiResult(aiText.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0,5).join(' '))}>Local summary</button><button className="lc-btn" disabled={busy} onClick={()=>void run(aiImage)}>Generate image</button></div>{aiResult?<><p>{aiResult}</p><button className="lc-btn" disabled={busy} onClick={()=>void run(async()=>{await onSend({type:'text',text:aiResult,lane:'General'},aiResult);onClose();})}>Send summary</button></>:null}</>:null}
 {error?<p role="alert">{error}</p>:null}
 </Dialog>;
}
export function DesktopVaultDialog({runtime,onClose}:{runtime:Ready;onClose:()=>void}){
 const client=useMemo(()=>new FileVaultClient(getApiBaseUrl(),runtime.getToken,undefined,undefined,'linqa-desktop-vault:'+runtime.userId),[runtime]);
 const [items,setItems]=useState<VaultItemSummary[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');const live=useRef(true);
 const load=async()=>{setBusy(true);try{const values=await client.list();if(live.current)setItems(values);}catch(e){if(live.current)setError(e instanceof Error?e.message:'Vault unavailable.');}finally{if(live.current)setBusy(false);}};
 useEffect(()=>{void load();return()=>{live.current=false;};},[client]);
 const upload=async(file:File)=>{if(file.size<=0||file.size>MAX_FILE_BYTES){setError('Choose a file up to 25 MB.');return;}setBusy(true);setError('');try{await client.upload({itemType:file.type.startsWith('image/')?'PHOTO':'DOCUMENT',name:file.name,metadata:{mimeType:file.type},content:new Uint8Array(await file.arrayBuffer()),contentType:file.type||'application/octet-stream'});await load();}catch(e){if(live.current)setError(e instanceof Error?e.message:'Could not save file.');}finally{if(live.current)setBusy(false);}};
 return <Dialog title="Linqa Vault" onClose={onClose}><p className="lc-dialog-note">Encrypted storage. This computer holds its own Vault key. Items whose key stays on your phone are listed as locked.</p><input type="file" aria-label="Save to Vault" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f);}}/><button className="lc-btn" disabled={busy} onClick={()=>void load()}>Refresh</button>{items.map(item=><div className="lc-feature-card" key={item.id}><strong>{item.name}</strong><p>{Math.ceil(item.encryptedSize/1024)} KB</p><button className="lc-btn" disabled={busy||item.metadata.locked===true} onClick={()=>void client.download(item.id,item.itemType).then(bytes=>downloadBlob(new Blob([Uint8Array.from(bytes)],{type:String(item.metadata.mimeType??'application/octet-stream')}),item.name)).catch(e=>setError(String(e)))}>Download</button></div>)}{busy?<p>Working?</p>:items.length===0?<p>No files yet.</p>:null}{error?<p role="alert">{error}</p>:null}</Dialog>;
}
