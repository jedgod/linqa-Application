import {mkdir,open,readFile,link,unlink} from 'node:fs/promises';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {sha256,MediaError} from './media-service.mjs';
export class PrivateBlobStore {
 constructor(root){this.root=root;}
 path(id){if(!/^[a-f0-9-]{36}$/i.test(id))throw new MediaError('INVALID_UPLOAD_ID',400);return join(this.root,id);}
 async putImmutable(id,bytes,digest){
  await mkdir(this.root,{recursive:true,mode:0o700});const target=this.path(id),temp=join(this.root,`.upload-${randomUUID()}`);let file;
  try{
   file=await open(temp,'wx',0o600);await file.writeFile(bytes);await file.sync();await file.close();file=null;
   try{await link(temp,target);}catch(error){if(error.code!=='EEXIST')throw error;const old=await readFile(target);if(sha256(old)!==digest)throw new MediaError('UPLOAD_CONFLICT',409);}
   const dir=await open(this.root,'r');try{await dir.sync();}finally{await dir.close();}
  }finally{await file?.close();await unlink(temp).catch(()=>undefined);}
 }
 async read(id){return readFile(this.path(id));}
}
