/* Adapter-backed integration test requirements. Wire to the Linqa test DB. */
describe('biometric v5 security invariants',()=>{
 test.todo('rejects replayed challenge');
 test.todo('rejects replayed grant');
 test.todo('rejects cross-user signature');
 test.todo('rejects cross-device signature');
 test.todo('rejects cross-session signature');
 test.todo('rejects stale security epoch after recovery');
 test.todo('rejects revoked credential');
 test.todo('rejects production enrollment when attestation fails');
 test.todo('rejects amount mutation after biometric challenge');
 test.todo('rejects recipient mutation after biometric challenge');
 test.todo('rejects quote version mutation after biometric challenge');
 test.todo('rejects transfer version mutation before grant consumption');
 test.todo('rejects Vault grant for LinqaSend purpose');
 test.todo('rejects LinqaSend grant for Vault purpose');
 test.todo('risk denial overrides biometric success');
 test.todo('business Vault policy denial overrides biometric success');
});
