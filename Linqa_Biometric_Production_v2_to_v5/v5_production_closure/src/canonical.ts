import crypto from 'node:crypto';
function stable(v:any):string{
 if(v===null||typeof v!=='object')return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(stable).join(',')+']';
 return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
}
export function hashResource(v:unknown){return crypto.createHash('sha256').update(stable(v),'utf8').digest()}
export function signingPayload(x:{challengeId:string;challenge:string;purpose:string;resourceHashHex:string;userId:string;installationId:string;deviceId:string;sessionId:string;securityEpoch:number}){
 return Buffer.from(stable({v:5,...x}),'utf8');
}
