import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Server-only: do not import React Native modules or expose backend secrets to mobile.
const serverDirectory = fileURLToPath(new URL('../server/', import.meta.url));
async function check(args: string[]) {
  const started = performance.now();
  return new Promise<{ passed: boolean; durationMs: number }>((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: serverDirectory, env: process.env, stdio: 'inherit', shell: false,
      windowsHide: true, timeout: 180_000,
    });
    let finished = false;
    const finish = (passed: boolean) => {
      if (finished) return;
      finished = true;
      resolve({ passed, durationMs: Math.round(performance.now() - started) });
    };
    child.once('error', () => finish(false));
    child.once('close', (code) => finish(code === 0));
  });
}

async function main() {
  const typecheck = await check(['node_modules/typescript/bin/tsc', '--noEmit']);
  const readiness = await check([
    '--env-file-if-exists=.env', '--import', './node_modules/tsx/dist/loader.mjs',
    'src/jobs/wallet-provider-preflight.ts',
  ]);
  const passed = typecheck.passed && readiness.passed;
  console.log(JSON.stringify({ event: 'integration.parity', typecheck, readiness, passed }));
  // No migrations, secret injection, account activation, or network listener startup.
  process.exitCode = passed ? 0 : 1;
}
void main().catch(() => { console.error('INTEGRATION_PARITY_FAILED'); process.exitCode = 1; });
