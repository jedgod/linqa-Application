/**
 * Production adapter requirements:
 * - stream object to ClamAV over a private network; no public scanner endpoint
 * - enforce scanner timeout and maximum bytes
 * - ERROR is fail-closed, never CLEAN
 * - record engine/database version in audit metadata
 * - never log file content
 */
export class ClamAvScanner {
 constructor(private scan:(key:string)=>Promise<{infected:boolean;signature?:string;engine:string}>){}
 async scanObject(key:string){try{const x=await this.scan(key);return {verdict:x.infected?'MALICIOUS' as const:'CLEAN' as const,engine:x.engine,signature:x.signature}}catch{return {verdict:'ERROR' as const,engine:'clamav'}}}
}
