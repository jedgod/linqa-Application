import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { ChatApi } from '../chatApi';
import type { FileContent, FileKind } from './types';
import { validateContent } from './codec';
export const MAX_FILE_BYTES=25*1024*1024;
export function b64e(bytes:Uint8Array):string {let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
export function b64d(s:string):Uint8Array {if(!/^[A-Za-z0-9+/]*={0,2}$/.test(s)||s.length%4!==0)throw Error('Invalid encrypted file');return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
const aad=(conversationId:string,id:string,mime:string)=>new TextEncoder().encode(JSON.stringify(['linqa:conversation-media:v1',conversationId,'linqa-feature-file-v1',id,mime]));
const nameOf=(s:string)=>s.replace(/[\\/\x00-\x1f]/g,'_').slice(0,180)||'attachment';
export function classify(mime:string):FileKind{return /^image\/(jpeg|png|gif|webp)$/.test(mime)?'image':/^video\/(mp4|webm|quicktime)$/.test(mime)?'video':/^audio\//.test(mime)?'voice':'document';}
export class DesktopFiles {
 constructor(private api:ChatApi,private conversationId:string){}
 async upload(file:File,details:{durationMs?:number;caption?:string}={}):Promise<FileContent>{
  if(file.size<=0||file.size>MAX_FILE_BYTES)throw Error('Choose a nonempty file up to 25 MB.');
  const plain=new Uint8Array(await file.arrayBuffer()),key=crypto.getRandomValues(new Uint8Array(32)),nonce=crypto.getRandomValues(new Uint8Array(24));
  try{
   const id=crypto.randomUUID(),mime=file.type.split(';')[0]||'application/octet-stream';
   const sealed=xchacha20poly1305(key,nonce,aad(this.conversationId,id,mime)).encrypt(plain);
   const envelope=new Uint8Array(24+sealed.length);envelope.set(nonce);envelope.set(sealed,24);
   const content:FileContent={type:'file',fileKind:classify(mime),name:nameOf(file.name),mime,size:plain.length,blobId:id,key:b64e(key),nonce:b64e(nonce),sha256:bytesToHex(sha256(plain)),...details};
   if(!validateContent(content))throw Error('Invalid attachment details');
   await this.api.uploadFeatureBlob(this.conversationId,id,b64e(envelope));return content;
  }finally{plain.fill(0);key.fill(0);}
 }
 async openLegacy(senderUserId:string,media:{mediaId:string;mediaKey:string;mimeType:string;mediaDigest?:string}):Promise<Blob>{
  const encoded=await this.api.downloadFeatureBlob(this.conversationId,media.mediaId);
  if(encoded.length>Math.ceil((MAX_FILE_BYTES+40)/3)*4)throw Error('File exceeds 25 MB.');
  const envelope=b64d(encoded),key=b64d(media.mediaKey);let plain:Uint8Array|undefined;
  try{
   if(key.length!==32||envelope.length<41||(media.mediaDigest&&bytesToHex(sha256(envelope))!==media.mediaDigest))throw Error('Media integrity check failed');
   const context=new TextEncoder().encode(JSON.stringify(['linqa:conversation-media:v1',this.conversationId,senderUserId,media.mediaId,media.mimeType]));
   plain=xchacha20poly1305(key,envelope.subarray(0,24),context).decrypt(envelope.subarray(24));return new Blob([Uint8Array.from(plain)],{type:media.mimeType});
  }finally{key.fill(0);plain?.fill(0);}
 }
 async open(file:FileContent):Promise<Blob>{
  if(!validateContent(file))throw Error('Invalid attachment');
  const encoded=await this.api.downloadFeatureBlob(this.conversationId,file.blobId);
  if(encoded.length>Math.ceil((MAX_FILE_BYTES+40)/3)*4)throw Error('File exceeds 25 MB.');
  const envelope=b64d(encoded),key=b64d(file.key);let plain:Uint8Array|undefined;
  try{
   if(key.length!==32||envelope.length<41||b64e(envelope.subarray(0,24))!==file.nonce)throw Error('File integrity check failed');
   plain=xchacha20poly1305(key,envelope.subarray(0,24),aad(this.conversationId,file.blobId,file.mime)).decrypt(envelope.subarray(24));
   if(plain.length!==file.size||bytesToHex(sha256(plain))!==file.sha256)throw Error('File integrity check failed');
   return new Blob([Uint8Array.from(plain)],{type:file.mime});
  }finally{key.fill(0);plain?.fill(0);}
 }
}
export function downloadBlob(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=nameOf(name);a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
