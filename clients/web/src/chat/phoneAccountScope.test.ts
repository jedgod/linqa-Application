import {expect,it,vi} from 'vitest';
import {SecureCoreDevice,type CoreBridge} from '../../../mobile/services/secure-core';
import {clearAccountScopedState} from '../../../mobile/services/account-scope';
function fixture(){
 const bridge={createCore:vi.fn(async()=>true)} as unknown as CoreBridge;
 const store={get:async(key:string)=>key==='device.id'?'phone':btoa(String.fromCharCode(...new Uint8Array(32))),put:vi.fn(async()=>{})};
 return {bridge,store};
}
it('a ready native session becomes unusable when the account changes',async()=>{
 const {bridge,store}=fixture();const device=new SecureCoreDevice(bridge,store,'account-a');await device.ensure();expect(bridge.createCore).toHaveBeenCalledTimes(1);
 clearAccountScopedState();expect(()=>device.ensure()).toThrow('SECURE_CORE_UNAVAILABLE');await expect(device.deviceId()).rejects.toThrow('SECURE_CORE_UNAVAILABLE');
 const next=new SecureCoreDevice(bridge,store,'account-b');await next.ensure();expect(bridge.createCore).toHaveBeenCalledTimes(2);
});
it('late key reads from an old account cannot overwrite the native core',async()=>{
 const {bridge,store}=fixture();let release!:()=>void;const wait=new Promise<void>(resolve=>release=resolve);
 const device=new SecureCoreDevice(bridge,{...store,get:async key=>{await wait;return store.get(key);}},'account-a');
 const pending=device.ensure();clearAccountScopedState();release();await expect(pending).rejects.toThrow('SECURE_CORE_UNAVAILABLE');expect(bridge.createCore).not.toHaveBeenCalled();
});
