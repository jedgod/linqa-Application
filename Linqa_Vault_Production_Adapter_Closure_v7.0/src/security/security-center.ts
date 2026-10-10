import type {Principal,DeviceTrustAdapter,TwoFactorAdapter,LoginAlertAdapter} from '../contracts.js';
export class SecurityCenterService{
 constructor(private devices:DeviceTrustAdapter,private two:TwoFactorAdapter,private alerts:LoginAlertAdapter){}
 async get(p:Principal){
  const [list,two,alerts]=await Promise.all([this.devices.list(p.accountId,p.userId),this.two.status(p.accountId,p.userId),this.alerts.status(p.accountId,p.userId)]);
  return {encryption:{enabled:true,mode:'CLIENT_E2EE'},integrity:{enabled:true},
   twoFactor:two,trustedDevices:{count:list.filter((x:any)=>x.status==='ACTIVE').length,devices:list},
   loginAlerts:alerts};
 }
}
