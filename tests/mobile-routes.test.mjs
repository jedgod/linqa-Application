import test from 'node:test';
import assert from 'node:assert/strict';
import { connectedPhones, routeMappings, missingRoutes } from '../scripts/lib/mobile-routes.mjs';
test('LG Wi-Fi remains recoverable when its USB transport goes offline', () => {
  assert.deepEqual(connectedPhones('LMX320969df2b0 offline\n10.0.0.27:5555 device product:x model:LM_X320 device:x\nR9TT703HH0Y device model:SM_A037U\nother device model:Pixel'), ['10.0.0.27:5555','R9TT703HH0Y']);
});
test('incorrect and lost API/Metro mappings are repaired using actual server ports', () => {
  const mappings = routeMappings(8089,8082);
  assert.deepEqual(missingRoutes('UsbFfs tcp:8080 tcp:8080\nUsbFfs tcp:8081 tcp:8082', mappings), [[8080,8089],[8088,8089],[8082,8082],[8083,8082]]);
  assert.deepEqual(missingRoutes(mappings.map(([a,b])=>`UsbFfs tcp:${a} tcp:${b}`).join('\n'),mappings), []);
});
