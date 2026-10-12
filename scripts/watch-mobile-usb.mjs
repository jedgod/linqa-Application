// Keeps only the named Linqa test phones connected to the local development
// servers. USB reverse rules disappear when a transport reconnects.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connectedPhones, routeMappings, missingRoutes } from './lib/mobile-routes.mjs';
import { execFileSync } from 'node:child_process';

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.LOCALAPPDATA, 'Android/Sdk');
const adb = path.join(sdk, 'platform-tools/adb.exe');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const statePath = path.join(root, '.runtime/mobile-launch/state.json');
// A recent heartbeat avoids duplicate watchers and stale/reused Windows PIDs.
let startupState = {};
try { startupState = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}
if (startupState.routes?.pid !== process.pid && Date.now() - Date.parse(startupState.routes?.heartbeatAt || '') < 15000) {
  try { process.kill(startupState.routes.pid, 0); process.exit(0); } catch {}
}
fs.mkdirSync(path.dirname(statePath), { recursive: true });
startupState.routes = { pid: process.pid, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() };
fs.writeFileSync(statePath, JSON.stringify(startupState, null, 2) + '\n');
const run = args => execFileSync(adb, args, { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore','pipe','pipe'] });
let busy = false;
let lastError = '';
async function check() {
  if (busy) return;
  busy = true;
  try {
    let state = {}; try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}
    state.routes = { pid: process.pid, startedAt: startupState.routes.startedAt, heartbeatAt: new Date().toISOString() };
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
    const apiPort = Number(process.env.LINQA_API_PORT || state.apiPort || 8088);
    const metroPort = Number(process.env.LINQA_METRO_PORT || state.metroPort || 8082);
    // Restore transport rules even while the API is restarting.
    for (const serial of connectedPhones(run(['devices','-l']))) {
      try {
      const missing = missingRoutes(run(['-s',serial,'reverse','--list']), routeMappings(apiPort, metroPort));
      if (!missing.length) continue;
      for (const [local,remote] of missing) run(['-s',serial,'reverse',`tcp:${local}`,`tcp:${remote}`]);
      console.log(`${new Date().toISOString()} restored ${missing.length} routes on ${serial}`);
      } catch (error) { console.error(`${serial}: ${error.message}`); }
    }
    lastError = '';
  } catch (error) {
    const message = error.message;
    if (message !== lastError) console.error(`${new Date().toISOString()} ${message}`);
    lastError = message;
  } finally { busy = false; }
}
console.log('Watching LG and Galaxy USB/Wi-Fi routes; ports follow the mobile launcher.');
await check();
setInterval(() => void check(), 2000);
