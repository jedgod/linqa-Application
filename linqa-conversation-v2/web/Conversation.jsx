import React,{useState,useEffect} from 'react';
import {useConversation} from '../shared/useConversation.jsx';
import {THEMES,LANES} from '../shared/engine.mjs';
import './conversation.css';
export default function Conversation({client,conversationId,peer,onBack,onCall,onSafety,onBlock,onAttach,settingsStore}) {
 const chat=useConversation(client,conversationId);
 const [text,setText]=useState(''),[lane,setLane]=useState('All'),[settings,setSettings]=useState(false),[theme,setTheme]=useState('violet'),[quiet,setQuiet]=useState(false);
 const [notice,setNotice]=useState('');const colors=THEMES[theme];
 useEffect(()=>{let live=true;settingsStore?.load(conversationId).then(p=>{if(live&&p){if(THEMES[p.theme])setTheme(p.theme);setQuiet(!!p.quiet);}}).catch(()=>{});return()=>{live=false;};},[settingsStore,conversationId]);
 async function preference(next){
  try{if(!settingsStore)throw new Error('Missing settings adapter');await settingsStore.save(conversationId,next);setNotice('Preference saved on this device.');}
  catch{setNotice('Could not save preference.');}
 }
 async function submit(e){e.preventDefault();if(!text.trim())return;const value=text;if(await chat.send({type:'text',text:value,lane:lane==='All'?'General':lane}))setText('');}
 async function decision(){
  const title=window.prompt('Decision title');if(!title)return;
  const a=window.prompt('First option');const b=window.prompt('Second option');if(!a||!b||a===b)return;
  await chat.send({type:'decision',title,options:[a,b]});
 }
 function action(fn){if(fn)fn();else setNotice('Connect this action to the existing Linqa module.');}
 return <section className="lc" style={{'--bg':colors.background,'--surface':colors.surface,'--ink':colors.ink,'--accent':colors.accent,'--incoming':colors.incoming,'--highlight':colors.highlight}}>
  <header><button aria-label="Back" onClick={onBack}>←</button><div className="lc-avatar">{peer.displayName?.slice(0,1)}</div><div className="lc-person"><strong>{peer.displayName}</strong><small>Conversation</small></div><button onClick={()=>action(onCall?()=>onCall('audio',peer.id):null)} aria-label="Voice call">☎</button><button onClick={()=>action(onCall?()=>onCall('video',peer.id):null)}>Video</button><button onClick={()=>setSettings(!settings)} aria-label="Conversation settings">⚙</button></header>
  <nav>{LANES.map(x=><button key={x} className={lane===x?'selected':''} onClick={()=>setLane(x)}>{x}</button>)}<button disabled={chat.sending} onClick={decision}>＋ Decision board</button></nav>
  {settings&&<aside><h3>Conversation settings</h3><label>Appearance <select value={theme} onChange={e=>{setTheme(e.target.value);preference({theme:e.target.value,quiet});}}>{Object.keys(THEMES).map(x=><option key={x}>{x}</option>)}</select></label><label><input type="checkbox" checked={quiet} onChange={e=>{setQuiet(e.target.checked);preference({theme,quiet:e.target.checked});}}/> Quiet this conversation on this device</label><button onClick={()=>action(onSafety?()=>onSafety(peer.id):null)}>Verify safety number</button><button onClick={()=>action(onBlock?()=>onBlock(peer.id):null)}>Block contact</button><small>Quiet applies through your notification adapter. Blocking applies through the canonical server policy.</small></aside>}
  {(chat.error||notice)&&<div role="status" className="lc-notice">{chat.error||notice}</div>}
  <main aria-label="Message history" aria-live="polite">
   {!chat.messages.length&&<div className="lc-empty"><h2>Begin something worth sharing.</h2><p>Say hello to {peer.displayName}, organize ideas, or decide together.</p></div>}
   {chat.messages.filter(x=>lane==='All'||x.payload.type==='decision'||x.payload.lane===lane).map(x=><article key={x.id} className={x.sender_id===client.actor.userId?'outgoing':'incoming'}>
    {x.payload.type==='text'?<p>{x.payload.text}</p>:<div className="lc-board"><small>Decision board</small><h3>{x.payload.title}</h3>{x.payload.options.map((o,i)=><button key={i} disabled={chat.sending} className={x.votes[client.actor.userId]===i?'selected':''} onClick={()=>chat.send({type:'vote',boardId:x.client_id,choice:i})}>{o}<span>{Object.values(x.votes).filter(v=>v===i).length} votes</span></button>)}</div>}
    <small>{new Date(x.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</small>
   </article>)}
   {chat.pending.map(d=><article key={d.clientId} className="outgoing"><p>{d.payload.type==='text'?d.payload.text:d.payload.type==='decision'?d.payload.title:'Your vote'}</p><small>{d.status==='accepted'?'Accepted by relay':d.status}</small>{d.status==='failed'&&<button disabled={chat.sending} onClick={()=>chat.retry(d)}>Retry</button>}</article>)}
  </main>
  <form onSubmit={submit}><button type="button" aria-label="Add attachment" onClick={()=>action(onAttach)}>＋</button><input aria-label="Message" maxLength={8000} placeholder="Write a message…" value={text} onChange={e=>setText(e.target.value)}/><button className="lc-send" disabled={chat.sending||!text.trim()}>Send ↗</button></form>
 </section>;
}
