// USB (or authorized wireless ADB) is needed only to configure/open the phone.
// The application itself uses the LAN for both Metro and the API.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { readJson, portAvailable, selectDevice, waitUntil } from './lib/mobile-launch.mjs';

// Expo's no-Git fallback recursively scans native build output for ignore files.
// GUI-launched Windows shells may omit Git even when Git for Windows is installed.
if (process.platform === 'win32') {
  const gitDirs = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
    .filter(Boolean).map(base => path.join(base, 'Git', 'cmd'));
  const gitDir = gitDirs.find(dir => fs.existsSync(path.join(dir, 'git.exe')));
  if (gitDir) process.env.PATH = gitDir + path.delimiter + process.env.PATH;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobile = path.join(root, 'clients/mobile');
const runtime = path.join(root, '.runtime/mobile-launch');
fs.mkdirSync(runtime, { recursive: true });
const stateFile = path.join(runtime, 'wifi-state.json');
let state = {};
const children = new Map();
try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');

function start(name, args, cwd, env) {
  const log = fs.openSync(path.join(runtime, `wifi-${name}.log`), 'a');
  const child = spawn(process.execPath, args, {
    cwd, env: { ...process.env, ...env }, detached: true, windowsHide: true,
    stdio: ['ignore', log, log]
  });
  fs.closeSync(log);
  child.on('error', error => console.error(error.message));
  children.set(name, child);
  child.unref();
  state[name] = { pid: child.pid, startedAt: new Date().toISOString() };
  save();
}

async function main() {
  const interfaces = Object.entries(os.networkInterfaces()).flatMap(([name, addresses]) =>
    (addresses || []).filter(a => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
      .map(a => ({ name, address: a.address })));
  const host = process.env.LINQA_WIFI_HOST || interfaces.find(a => /wi-?fi|wireless/i.test(a.name))?.address;
  if (!host || net.isIP(host) !== 4 || !interfaces.some(a => a.address === host)) {
    throw new Error('Connect this computer to Wi-Fi, or set LINQA_WIFI_HOST to its LAN IPv4 address.');
  }
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.LOCALAPPDATA, 'Android/Sdk');
  const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  const run = (...args) => execFileSync(adb, args, { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const devices = run('devices', '-l');
  const serverOnly = process.argv.includes('--serve') || !/^\S+\s+device(?:\s|$)/m.test(devices);
  const savedConnected = devices.split(/\r?\n/).some(line => {
    const [id, status] = line.trim().split(/\s+/);
    return id === state.serial && status === 'device';
  });
  const serial = serverOnly ? null : selectDevice(devices, process.env.ANDROID_SERIAL || (savedConnected ? state.serial : undefined));
  const phone = (...args) => run('-s', serial, ...args);
  if (serial && !phone('shell', 'pm', 'list', 'packages', 'com.linqa.mobile').includes('package:com.linqa.mobile')) {
    throw new Error('Install the Linqa Android debug build first. Expo Go cannot load its native modules.');
  }
  const ready = async port => {
    const result = await readJson(`http://${host}:${port}/health/ready`, {}, 5000);
    return result?.service === 'linqa-api' && result.status === 'ready';
  };
  let apiPort;
  for (const candidate of [8088, 8089]) if (await ready(candidate)) { apiPort = candidate; break; }
  if (!apiPort) {
    for (const candidate of [8088, 8089]) if (await portAvailable(candidate)) { apiPort = candidate; break; }
    if (!apiPort) throw new Error('API ports are occupied. An existing API must listen on the LAN, not only localhost.');
    start('api', ['--env-file=.env', '--import', 'tsx', 'src/index.ts'], path.join(root, 'server'), {
      HOST: '0.0.0.0', PORT: String(apiPort), LINQA_API_PORT: String(apiPort)
    });
    await waitUntil(() => ready(apiPort), 'Wi-Fi API', 300000);
  }
  // A separate port prevents accidentally reusing a USB Metro with a localhost API URL.
  const metroPort = Number(process.env.LINQA_WIFI_METRO_PORT || 8084);
  if (!Number.isInteger(metroPort) || metroPort < 1024 || metroPort > 65535) throw new Error('Invalid Metro port.');
  const apiUrl = `http://${host}:${apiPort}`;
  const metroUrl = `http://${host}:${metroPort}`;
  const metroReady = async () => {
    try {
      const response = await fetch(metroUrl + '/status', { signal: AbortSignal.timeout(5000) });
      const project = response.headers.get('x-react-native-project-root');
      return response.ok && project && path.resolve(decodeURIComponent(project)).toLowerCase() === mobile.toLowerCase()
        && (await response.text()).trim() === 'packager-status:running';
    } catch { return false; }
  };
  if (await portAvailable(metroPort)) {
    state.host = host;
    state.apiUrl = apiUrl;
    start('metro', ['node_modules/expo/bin/cli', 'start', '--host', 'lan', '--port', String(metroPort), '--max-workers', '1',
      ...(process.env.LINQA_WIFI_RESET_CACHE === '1' ? ['--clear'] : [])], mobile, {
      EXPO_PUBLIC_API_URL: apiUrl, REACT_NATIVE_PACKAGER_HOSTNAME: host,
      // Expo Go with a signed-in account needs a signed manifest, which requires online mode.
      EXPO_OFFLINE: process.env.LINQA_WIFI_ONLINE === '1' ? '0' : '1',
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--dns-result-order=ipv4first'].filter(Boolean).join(' ')
    });
  } else if (state.host !== host || state.apiUrl !== apiUrl) {
    throw new Error(`Port ${metroPort} has an incompatible Metro. Stop that server or select another LINQA_WIFI_METRO_PORT.`);
  }
  console.log(`Waiting for Metro on ${metroUrl}. Logs: .runtime/mobile-launch/wifi-metro.log`);
  await waitUntil(async () => {
    const child = children.get('metro');
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error('Metro exited during startup. Read .runtime/mobile-launch/wifi-metro.log.');
    }
    return metroReady();
  }, 'Wi-Fi Metro', 600000);
  const checkFromPhone = (port, endpoint, expected) => {
    const request = `GET ${endpoint} HTTP/1.1\\r\\nHost: ${host}:${port}\\r\\nConnection: close\\r\\n\\r\\n`;
    // Keep stdin open while the API handles its asynchronous database check.
    // Toybox nc otherwise half-closes immediately and aborts the HTTP request.
    const output = phone('shell', `(printf '${request}'; sleep 2) | toybox nc -w 10 ${host} ${port}`);
    if (!output.includes(expected)) throw new Error(`Phone cannot reach ${host}:${port}. Check that both devices use the same Wi-Fi and Windows allows this port.`);
  };
  if (serial) {
    checkFromPhone(metroPort, '/status', 'packager-status:running');
    checkFromPhone(apiPort, '/health/ready', '"status":"ready"');
  }
  console.log('Building the Android bundle before opening Linqa…');
  // The installed client uses Expo Router. This endpoint avoids the expensive
  // native-runtime manifest resolver while warming the same Metro graph.
  const bundle = new URL('/node_modules/expo-router/entry.bundle', metroUrl);
  bundle.search = new URLSearchParams({ platform: 'android', dev: 'true', hot: 'false', lazy: 'true',
    'transform.engine': 'hermes', 'transform.routerRoot': 'app', unstable_transformProfile: 'hermes-stable' }).toString();
  const response = await fetch(bundle, { signal: AbortSignal.timeout(600000) });
  if (!response.ok) throw new Error(`Bundle failed (${response.status}): ${(await response.text()).slice(0, 2000)}`);
  const bundleText = await response.text();
  if (!bundleText.includes(apiUrl)) throw new Error('Bundle does not contain the Wi-Fi API URL. Restart its Metro server.');
  if (!serial) {
    console.log(`Wi-Fi services ready. Open Linqa on the phone. API ${apiUrl}; Metro ${metroUrl}.`);
    if (state.phoneHost !== host || state.metroPort !== metroPort) {
      console.log('Connect the phone once to configure its new bundle address, then run this launcher again.');
    }
    return;
  }
  phone('shell', 'am', 'force-stop', 'com.linqa.mobile');
  // Preserve existing developer preferences and all application/account data.
  let prefs;
  try { prefs = phone('shell', 'run-as', 'com.linqa.mobile', 'cat', 'shared_prefs/com.linqa.mobile_preferences.xml'); }
  catch { prefs = '<map></map>'; }
  prefs = prefs.replace(/<map\s*\/>/, '<map></map>');
  if (!prefs.includes('</map>')) throw new Error('Cannot read Android developer preferences. Install a debug build.');
  const setting = `<string name="debug_http_host">${host}:${metroPort}</string>`;
  prefs = /<string name="debug_http_host">[^<]*<\/string>/.test(prefs)
    ? prefs.replace(/<string name="debug_http_host">[^<]*<\/string>/, setting)
    : prefs.replace(/<\/map>/, setting + '</map>');
  const encoded = Buffer.from(prefs).toString('base64');
  phone('shell', `run-as com.linqa.mobile sh -c 'echo ${encoded} | base64 -d > shared_prefs/com.linqa.mobile_preferences.xml'`);
  phone('shell', 'am', 'start', '-n', 'com.linqa.mobile/.MainActivity');
  state.serial = serial;
  state.phoneHost = host;
  state.metroPort = metroPort;
  save();
  console.log(`Linqa opened with Wi-Fi. API ${apiUrl}; Metro ${metroUrl}. USB may now be disconnected.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
