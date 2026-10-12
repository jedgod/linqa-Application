import {afterEach,expect,it,vi} from 'vitest';
import {SecureCoreServer} from '../../../mobile/services/secure-core-server';
afterEach(()=>vi.unstubAllGlobals());
it('refreshes encryption membership after adding a group member',async()=>{
 const self='11111111-1111-4111-8111-111111111111',peer='22222222-2222-4222-8222-222222222222',added='33333333-3333-4333-8333-333333333333';
 const members=[self,peer];const fetch=vi.fn(async(_url:string)=>new Response(JSON.stringify({members:members.map(userId=>({userId}))}),{status:200}));vi.stubGlobal('fetch',fetch);
 const server=new SecureCoreServer('https://test.local',async()=>'fixture-token');
 expect(await server.conversationMembers('group')).toEqual([self,peer]);members.push(added);
 expect(await server.conversationMembers('group')).toEqual([self,peer,added]);expect(fetch).toHaveBeenCalledTimes(2);
 expect(fetch.mock.calls[0][0]).toBe('https://test.local/v1/chats/group/controls');
});
it('refuses historical responses with a different sender identity',async()=>{
 vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({senderUserId:'wrong',senderDeviceId:'browser',signingPublicKey:Array(32).fill(0)}),{status:200}));
 const server=new SecureCoreServer('https://test.local',async()=>'fixture-token');
 await expect(server.historicalSenderKey({conversationId:'chat',messageId:'message',senderUserId:'self',senderDeviceId:'browser',ciphertextBase64:'ciphertext'})).rejects.toThrow('SENDER_UNKNOWN');
});
it('bypasses cached recipient keys before sending after unlink',async()=>{
 let revoked=false;const fetch=vi.fn(async()=>new Response(JSON.stringify({keyPackages:revoked?[]:[{deviceId:'browser',packageBase64:'fixture'}]}),{status:200}));vi.stubGlobal('fetch',fetch);
 const server=new SecureCoreServer('https://test.local',async()=>'fixture-token');
 expect(await server.keyPackages('user')).toHaveLength(1);revoked=true;
 expect(await server.keyPackages('user',true)).toEqual([]);expect(fetch).toHaveBeenCalledTimes(2);
});
