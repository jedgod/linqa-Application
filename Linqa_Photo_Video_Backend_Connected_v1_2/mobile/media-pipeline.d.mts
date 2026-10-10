import type {MediaDraft} from './ChatComposer';
import type {Scope,SqliteMediaQueue} from './sqlite-queue';
import type {AttachmentCrypto} from './connect-media';
export type MediaPayload={type:'media';version:1;kind:'photo'|'video';uploadId:string;caption:string;mimeType:string;name:string;byteLength:number;digest:string;attachment:unknown};
export class MediaPipeline {
 active:Set<string>;
 constructor(options:{queue:SqliteMediaQueue;crypto:AttachmentCrypto;files:{readEncrypted(uri:string):Promise<Uint8Array>};transport:{upload(scope:Scope,input:{uploadId:string;digest:string;bytes:Uint8Array}):Promise<{uploadId:string;digest:string;byteLength:number}>;download(scope:Scope,id:string):Promise<{bytes:Uint8Array}>};sendPayload(scope:Scope,payload:unknown,messageId:string):Promise<boolean>;newId():string;assertLive(scope:Scope):void});
 prepare(scope:Scope,draft:MediaDraft,caption:string):Promise<boolean>;
 resume(scope:Scope,uploadId:string):Promise<boolean>;
 receive(scope:Scope,payload:MediaPayload):Promise<string>;
}
