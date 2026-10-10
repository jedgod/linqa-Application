export type Principal={userId:string;sessionId?:string;deviceId?:string;scopes?:string[]};
export type WorkspaceKind='CONSUMER'|'BUSINESS';
export interface ObjectBlobStore { createUpload(input:{key:string;contentType:string;maxBytes:number}):Promise<{uploadUrl:string}>; head(key:string):Promise<{bytes:number;sha256?:string}>; delete(key:string):Promise<void>; createDownload?(key:string,ttlSeconds:number):Promise<string>; }
export interface PlatformContext { principal:Principal; requestId:string; ip?:string; userAgent?:string; }
