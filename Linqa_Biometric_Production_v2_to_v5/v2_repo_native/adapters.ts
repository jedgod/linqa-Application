export type LinqaPrincipal = {
  userId:string; installationId:string; deviceId:string; sessionId:string; authTime:Date;
};
export interface PrincipalAdapter { fromRequest(req:unknown):Promise<LinqaPrincipal>; }
export interface TrustedDeviceAdapter {
  get(p:LinqaPrincipal):Promise<{trusted:boolean;compromised:boolean;revoked:boolean;trustLevel:number}>;
}
export interface RiskAdapter {
  assess(input:{principal:LinqaPrincipal;purpose:string;resource:unknown}):Promise<{allow:boolean;score:number;reason?:string}>;
}
