// Starts only Linqa processes; preserves other services on conflicting ports.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { apiReady, portAvailable, readJson, resolveAndroidLaunchArgs, selectDevice, waitUntil } from "./lib/mobile-launch.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobile = path.join(root, "clients/mobile");
const runtime = path.join(root, ".runtime/mobile-launch");
const statePath = path.join(runtime, "state.json");
const started = [];
let state = {};
const jsonFile = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const saveState = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
const signature = createHash("sha256").update(fs.readFileSync(path.join(mobile, "package-lock.json"))).digest("hex");

function start(name, args, cwd, env) {
  const out = fs.openSync(path.join(runtime, name + ".log"), "a");
  let child;
  try {
    child = spawn(process.execPath, args, {
      cwd, env, detached: true, windowsHide: true, stdio: ["ignore", out, out]
    });
  } finally { fs.closeSync(out); }
  child.on("error", (error) => console.error(name + ": " + error.message));
  if (!child.pid) throw new Error("Could not start " + name);
  started.push(child);
  child.unref();
  state[name] = { pid: child.pid, startedAt: new Date().toISOString(), signature };
  saveState();
}

async function main() {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ??
    (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Android/Sdk"));
  const adb = sdk ? path.join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb") : "adb";
  const runAdb = (...args) => execFileSync(adb, args, { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  const serial = selectDevice(runAdb("devices", "-l"), process.env.ANDROID_SERIAL);
  const device = (...args) => runAdb("-s", serial, ...args);
  if (!device("shell", "pm", "list", "packages", "com.linqa.mobile").split(/\r?\n/).includes("package:com.linqa.mobile")) {
    throw new Error("Install clients/mobile first with npm run android. The native com.linqa.app is a separate client.");
  }
  for (const dependency of ["react-native-worklets", "react-native-reanimated"]) {
    const expected = jsonFile(path.join(mobile, "package.json")).dependencies[dependency];
    const installed = jsonFile(path.join(mobile, "node_modules", dependency, "package.json")).version;
    if (expected !== installed) throw new Error(dependency + " differs from the pinned version. Run npm ci in clients/mobile.");
  }
  fs.mkdirSync(runtime, { recursive: true });
  if (fs.existsSync(statePath)) state = jsonFile(statePath);
  let apiPort;
  for (const candidate of [8088, 8080, 8089]) {
    if (await apiReady(candidate)) { apiPort = candidate; break; }
  }
  if (!apiPort) {
    for (const candidate of [8088, 8089]) {
      if (await portAvailable(candidate)) { apiPort = candidate; break; }
    }
    if (!apiPort) throw new Error("Linqa API ports 8088 and 8089 are occupied by other services.");
    const server = path.join(root, "server");
    if (!fs.existsSync(path.join(server, ".env"))) throw new Error("Configure server/.env from server/.env.example first.");
    start("api", ["--env-file=.env", "--import", "tsx", "--watch", "src/index.ts"], server, {
      ...process.env, HOST: "127.0.0.1", PORT: String(apiPort), LINQA_API_PORT: String(apiPort)
    });
    await waitUntil(() => apiReady(apiPort), "Linqa API/database");
  }
  const metroReady = async () => {
    const manifest = await readJson("http://localhost:8081/", { "expo-platform": "android", accept: "application/json" }, 15_000);
    return manifest?.extra?.expoClient?._internal?.projectRoot === mobile;
  };
  if (!await portAvailable(8081)) {
    if (!await metroReady()) throw new Error("Port 8081 belongs to another server. Stop it before launching Linqa.");
    if (state.metro?.signature !== signature) throw new Error("Restart the existing Metro server after dependency changes; then run this launcher again.");
  } else {
    const env = {
      ...process.env,
      EXPO_PUBLIC_API_URL: "http://127.0.0.1:8080",
      EXPO_OFFLINE: "1",
      REACT_NATIVE_PACKAGER_HOSTNAME: "127.0.0.1",
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--dns-result-order=ipv4first"].filter(Boolean).join(" ")
    };
    delete env.CI;
    start("metro", ["node_modules/expo/bin/cli", "start", "--host", "localhost", "--port", "8081"], mobile, env);
    await waitUntil(metroReady, "Linqa Metro");
  }
  for (const [local, remote] of [[8080, apiPort], [8088, apiPort], [8081, 8081], [8083, 8081]]) {
    device("reverse", "tcp:" + local, "tcp:" + remote);
  }
  state.apiPort = apiPort;
  state.serial = serial;
  saveState();
  const launch = resolveAndroidLaunchArgs("com.linqa.mobile", ".MainActivity");
  device(...launch.forceStop);
  device(...launch.start);
  console.log("Linqa launched on " + serial + ". API: phone 127.0.0.1:8080 -> computer 127.0.0.1:" + apiPort + "; Metro: 8081.");
  console.log("Keep USB connected. Re-run this command after reconnecting. Logs: .runtime/mobile-launch/");
}

main().catch((error) => {
  for (const child of started) {
    try { child.kill(); } catch { /* process already exited */ }
  }
  console.error(error.message);
  process.exitCode = 1;
});
