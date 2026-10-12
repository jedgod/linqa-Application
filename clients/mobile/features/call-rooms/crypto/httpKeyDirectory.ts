import { SecureCoreServer } from "../../../services/secure-core-server";
import { base64ToBytes, text, type KeyPackageJson } from "../../../services/secure-core";
import { secureCoreModule } from "../../../modules/linqa-secure-core";
import type { CallSession } from "../ports";
import type { DevicePublicKeys,KeyDirectory } from "./linqaCore";
/** Validated signed key packages from the same directory used for chats. */
export class HttpKeyDirectory implements KeyDirectory {
  constructor(private readonly session:CallSession) {}
  async devices(userId:string):Promise<DevicePublicKeys[]> {
    const bridge=secureCoreModule();if(!bridge)throw new Error('native-core-required');
    // Fresh directory lookup so revocation is not hidden by a call-long cache.
    const packages=await new SecureCoreServer(this.session.apiBaseUrl,()=>this.session.getToken()).keyPackages(userId);
    if(packages.length>8)throw new Error('too-many-devices');
    const output:DevicePublicKeys[]=[];const ids=new Set<string>();
    for(const item of packages) {
      await bridge.verifyKeyPackage(item.packageBase64);
      const p=JSON.parse(text(base64ToBytes(item.packageBase64))) as KeyPackageJson;
      if(p.user_id!==userId || p.device_id!==item.deviceId || ids.has(p.device_id) || !Number.isSafeInteger(p.expires_at_unix) || p.expires_at_unix*1000<=Date.now())throw new Error('invalid-key-package');
      const valid=(a:unknown,n:number):a is number[]=>Array.isArray(a)&&a.length===n&&a.every(b=>Number.isInteger(b)&&b>=0&&b<=255);
      if(!valid(p.encryption_public_key,32)||!valid(p.pq_encryption_public_key,1184)||!valid(p.signing_public_key,32))throw new Error('invalid-key-package');
      ids.add(p.device_id);output.push({userId,deviceId:p.device_id,x25519:Uint8Array.from(p.encryption_public_key),mlkem768:Uint8Array.from(p.pq_encryption_public_key),ed25519:Uint8Array.from(p.signing_public_key)});
    }
    return output;
  }
  async device(userId:string,deviceId:string) {return (await this.devices(userId)).find(d=>d.deviceId===deviceId)??null;}
}
