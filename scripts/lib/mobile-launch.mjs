import net from "node:net";

export async function portAvailable(port) {
  // Windows may allow a loopback bind alongside an existing wildcard listener.
  // Probe the endpoint before trying to bind, so we never start a second Metro.
  const listening = await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (value) => { socket.destroy(); resolve(value); };
    socket.once("connect", () => finish(true));
    socket.once("error", (error) => finish(error.code !== "ECONNREFUSED"));
    socket.setTimeout(1000, () => finish(true));
  });
  if (listening) return false;
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") resolve(false);
      else reject(error);
    });
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

export async function readJson(url, headers = {}, timeout = 2000) {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

export async function apiReady(port) {
  const data = await readJson(`http://127.0.0.1:${port}/health/ready`);
  return data?.service === "linqa-api" && data.status === "ready";
}

export function selectDevice(output, requested) {
  const devices = output.split(/\r?\n/).map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[1] === "device");
  if (requested) {
    if (!devices.some(([serial]) => serial === requested)) throw new Error(`Device ${requested} is not connected and authorized.`);
    return requested;
  }
  if (devices.length !== 1) throw new Error(devices.length
    ? "Multiple devices connected. Set ANDROID_SERIAL to select the phone."
    : "Connect the phone by USB, enable USB debugging, and authorize this computer.");
  return devices[0][0];
}

export function resolveAndroidLaunchArgs(packageName, activity) {
  return {
    forceStop: ["shell", "am", "force-stop", packageName],
    start: [
      "shell",
      "am",
      "start",
      "-S",
      "-n",
      `${packageName}/${activity}`,
      "-a",
      "android.intent.action.MAIN",
      "-c",
      "android.intent.category.LAUNCHER"
    ]
  };
}

export async function waitUntil(check, description, timeout = 120_000) {
  const end = Date.now() + timeout;
  do {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < end);
  throw new Error(`${description} did not become ready. Check .runtime/mobile-launch/ logs.`);
}
