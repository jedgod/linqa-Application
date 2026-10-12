export class VoiceNoteRecorder {
 private recorder:MediaRecorder|null=null;private chunks:Blob[]=[];private startedAt=0;private generation=0;private starting=false;
 async start():Promise<void>{
  if(this.recorder||this.starting)throw Error('Recording already active.');
  this.starting=true;const generation=this.generation;let stream:MediaStream|undefined;
  try{
   stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
   if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());throw Error('Recording cancelled.');}
   this.chunks=[];this.startedAt=Date.now();
   const mime=['audio/webm;codecs=opus','audio/mp4'].find(m=>MediaRecorder.isTypeSupported(m));
   this.recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
   this.recorder.ondataavailable=e=>{if(e.data.size>0)this.chunks.push(e.data);};this.recorder.start(1000);
  }catch(e){stream?.getTracks().forEach(t=>t.stop());this.recorder=null;throw e;}finally{this.starting=false;}
 }
 async stop():Promise<{blob:Blob;durationMs:number}>{
  const recorder=this.recorder;if(!recorder)throw Error('No recording is active.');
  try{return await new Promise((resolve,reject)=>{
   recorder.onerror=()=>reject(Error('Voice recording failed.'));
   recorder.onstop=()=>{const durationMs=Date.now()-this.startedAt;const blob=new Blob(this.chunks,{type:recorder.mimeType||'audio/webm'});if(durationMs>300000||blob.size>25*1024*1024)reject(Error('Choose a recording under 5 minutes and 25 MB.'));else resolve({blob,durationMs});};recorder.stop();
  });}finally{recorder.stream.getTracks().forEach(t=>t.stop());if(this.recorder===recorder)this.recorder=null;this.chunks=[];}
 }
 cancel():void{this.generation++;const r=this.recorder;this.recorder=null;if(r){r.ondataavailable=null;r.onstop=null;try{if(r.state!=='inactive')r.stop();}catch{}r.stream.getTracks().forEach(t=>t.stop());}this.chunks=[];}
}
