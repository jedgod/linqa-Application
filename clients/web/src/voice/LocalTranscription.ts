type Recognizer={processLocally:boolean;continuous:boolean;interimResults:boolean;lang:string;onresult:((e:any)=>void)|null;onerror:((e:any)=>void)|null;onend:(()=>void)|null;start():void;stop():void;abort():void};
type Constructor={new():Recognizer;available?(options:{langs:string[];processLocally:boolean}):Promise<string>;install?(options:{langs:string[];processLocally:boolean}):Promise<boolean>};
function constructor():Constructor|undefined {const w=globalThis as unknown as {SpeechRecognition?:Constructor;webkitSpeechRecognition?:Constructor};return w.SpeechRecognition??w.webkitSpeechRecognition;}
export class LocalTranscription {
 private recognition:Recognizer|null=null;
 private generation=0;
 static supported(){const C=constructor();return !!C&&'processLocally' in new C()&&typeof C.available==='function';}
 static async install(){const C=constructor();if(!C?.install||!LocalTranscription.supported())throw Error('This browser does not support local transcription.');if(!await C.install({langs:['en-US'],processLocally:true}))throw Error('The English language pack could not be installed.');}
 async start(onText:(text:string)=>void,onError:(message:string)=>void){
  this.stop();const generation=this.generation;
  const C=constructor();if(!C||!LocalTranscription.supported())throw Error('Use a browser with on-device speech recognition. Audio will not be sent to a cloud transcription service.');
  if(await C.available!({langs:['en-US'],processLocally:true})!=='available')throw Error('Install the English language pack first.');
  if(generation!==this.generation)return;
  const r=new C();r.processLocally=true;r.lang='en-US';r.continuous=true;r.interimResults=false;
  r.onresult=e=>{for(let i=e.resultIndex;i<e.results.length;i++)if(e.results[i].isFinal)onText(String(e.results[i][0].transcript));};
  r.onerror=e=>onError(String(e.error||'Transcription stopped'));this.recognition=r;r.start();
 }
 stop(){this.generation++;const r=this.recognition;this.recognition=null;if(r){r.onresult=null;r.onerror=null;r.onend=null;r.abort();}}
}
