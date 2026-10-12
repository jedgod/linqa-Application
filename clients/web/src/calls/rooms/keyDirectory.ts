import type { RawWasmCoreBridge } from '../../core/RawWasmCoreBridge';
import type { ChatApi } from '../../chat/chatApi';
import type { DevicePublicKeys,KeyDirectory } from './crypto/linqaCore';
import { b64d } from './crypto/bytes';
export class DesktopKeyDirectory implements KeyDirectory {
 constructor(private core:RawWasmCoreBridge,private api:ChatApi){}
 async devices(userId:string):Promise<DevicePublicKeys[]>{
  this.api.forgetKeyPackages(userId);const packages=await this.api.keyPackages(userId);
  if(packages.length>8)throw Error('too-many-devices');
  const out:DevicePublicKeys[]=[];const ids=new Set<string>();
  for(const item of packages){
   const p=JSON.parse(new TextDecoder().decode(b64d(item.packageBase64)));await this.core.verifyKeyPackage(p);
   if(p.user_id!==userId||p.device_id!==item.deviceId||ids.has(p.device_id))throw Error('invalid-key-package');
   const valid=(a:unknown,n:number):a is number[]=>Array.isArray(a)&&a.length===n&&a.every(b=>Number.isInteger(b)&&b>=0&&b<=255);
   if(!valid(p.encryption_public_key,32)||!valid(p.pq_encryption_public_key,1184)||!valid(p.signing_public_key,32))throw Error('invalid-key-package');
   ids.add(p.device_id);out.push({userId,deviceId:p.device_id,x25519:Uint8Array.from(p.encryption_public_key),mlkem768:Uint8Array.from(p.pq_encryption_public_key),ed25519:Uint8Array.from(p.signing_public_key)});
  }return out;
 }
 async device(userId:string,id:string){return(await this.devices(userId)).find(d=>d.deviceId===id)??null;}
}
