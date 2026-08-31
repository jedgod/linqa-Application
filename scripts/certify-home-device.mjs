#!/usr/bin/env node
/**
 * Physical-device certification for Linqa Home.
 *
 * Launches the installed build on a real attached Android device, scans the
 * runtime log for fatal errors, captures a screenshot, and writes an
 * evidence manifest bound to the exact Git SHA.
 *
 * This cannot run on GitHub-hosted Linux CI. It is the approved
 * device-certification lane's job, and its output is what
 * `verify-home-evidence-freshness.mjs` and `verify-home-release-gate.mjs`
 * check. Usage:
 *
 *   ANDROID_SERIAL=R5CT10ABCDE \
 *   LINQA_ANDROID_APK=clients/android/app/build/outputs/apk/release/app-release.apk \
 *   node scripts/certify-home-device.mjs
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
    ...options
  }).trim();
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const gitSha = run("git", ["rev-parse", "HEAD"]);
if (run("git", ["status", "--porcelain"])) {
  // Evidence must describe a reproducible tree. A dirty worktree means the
  // manifest's SHA does not identify what was actually installed.
  fail("HOME_CERTIFICATION_REQUIRES_CLEAN_WORKTREE");
}

let serial = process.env.ANDROID_SERIAL;
if (!serial) {
  try {
    serial = run("adb", ["get-serialno"]);
  } catch {
    fail("HOME_CERTIFICATION_NO_DEVICE: attach a device or set ANDROID_SERIAL");
  }
}
if (!serial || serial === "unknown") fail("HOME_CERTIFICATION_NO_DEVICE");

const adb = (args, options) => run("adb", ["-s", serial, ...args], options);

const state = adb(["get-state"]);
if (state !== "device") fail(`HOME_CERTIFICATION_DEVICE_NOT_READY:${state}`);

const model = adb(["shell", "getprop", "ro.product.model"]);
const osRelease = adb(["shell", "getprop", "ro.build.version.release"]);
const packageName = process.env.LINQA_ANDROID_PACKAGE || "com.linqa.mobile";

const installed = adb(["shell", "pm", "list", "packages", packageName]);
if (!installed.includes(packageName)) {
  fail(`HOME_CERTIFICATION_PACKAGE_NOT_INSTALLED:${packageName}`);
}

// Clear the log before launching so the fatal scan below only sees this run,
// not whatever a previous session left behind.
try {
  adb(["logcat", "-c"]);
} catch {
  console.warn("warning: could not clear logcat; the fatal scan may include earlier output");
}

adb(["shell", "am", "force-stop", packageName]);
adb(["shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1"]);

const settleMs = Number(process.env.HOME_CERTIFICATION_SETTLE_MS ?? 8_000);
await new Promise((resolve) => setTimeout(resolve, settleMs));

const logcat = adb(["logcat", "-d", "-t", "800"]);
const FATAL_PATTERNS = [
  { name: "FATAL_EXCEPTION", pattern: /FATAL EXCEPTION/i },
  { name: "REACT_NATIVE_TYPE_ERROR", pattern: /ReactNativeJS.*TypeError/i },
  { name: "REACT_NATIVE_REFERENCE_ERROR", pattern: /ReactNativeJS.*ReferenceError/i },
  { name: "ACTIVITY_START_FAILED", pattern: /Unable to start activity/i },
  { name: "APPLICATION_NOT_RESPONDING", pattern: new RegExp(`ANR in ${packageName}`, "i") },
  { name: "NATIVE_CRASH", pattern: /signal \d+ \(SIG\w+\), code/i },
  { name: "PROCESS_DIED", pattern: new RegExp(`Process ${packageName} .*has died`, "i") }
];

const fatalRuntimeErrors = FATAL_PATTERNS
  .filter((entry) => entry.pattern.test(logcat))
  .map((entry) => entry.name);

// The app must still be running: a build that launches and immediately exits
// has "no fatal log line" and is still broken.
const psOutput = adb(["shell", "pidof", packageName]).trim();
if (!psOutput) fatalRuntimeErrors.push("PROCESS_NOT_RUNNING_AFTER_LAUNCH");

mkdirSync("evidence/home", { recursive: true });

const screenshotFile = path.resolve(`evidence/home/${gitSha}-${serial}-home.png`);
const screenshot = execFileSync("adb", ["-s", serial, "exec-out", "screencap", "-p"], {
  maxBuffer: 64 * 1024 * 1024
});
if (!screenshot?.length) fail("HOME_CERTIFICATION_SCREENSHOT_EMPTY");
writeFileSync(screenshotFile, screenshot);

const logFile = path.resolve(`evidence/home/${gitSha}-${serial}-logcat.txt`);
writeFileSync(logFile, logcat, "utf8");

const apkFile = process.env.LINQA_ANDROID_APK;
if (apkFile && !existsSync(apkFile)) fail(`HOME_CERTIFICATION_APK_MISSING:${apkFile}`);

const manifest = {
  schemaVersion: 1,
  certification: "LINQA_HOME_PHYSICAL_DEVICE",
  gitSha,
  certifiedAt: new Date().toISOString(),
  device: { serial, model, os: osRelease },
  packageName,
  apkFile: apkFile ? path.resolve(apkFile) : null,
  apkSha256: apkFile ? sha256File(apkFile) : null,
  screenshot: screenshotFile,
  screenshotSha256: sha256File(screenshotFile),
  logcat: logFile,
  logcatSha256: sha256File(logFile),
  fatalPatternsChecked: FATAL_PATTERNS.map((entry) => entry.name),
  fatalRuntimeErrors,
  passed: fatalRuntimeErrors.length === 0
};

const manifestFile = path.resolve(`evidence/home/${gitSha}-${serial}-manifest.json`);
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify(manifest, null, 2));

if (!manifest.passed) {
  fail(`HOME_DEVICE_CERTIFICATION_FAILED:${fatalRuntimeErrors.join(",")}`);
}
