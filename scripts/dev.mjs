import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronPath = require('electron');
const port = process.env.DROIDBRIDGE_PORT ?? '5173';
const devServerUrl = `http://localhost:${port}`;

/** @type {{ name: string, child: import('node:child_process').ChildProcess }[]} */
const children = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  setTimeout(() => process.exit(code), 200);
}

function run(name, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...env },
  });
  children.push({ name, child });
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`[dev] ${name} exited (code=${code} signal=${signal})`);
      shutdown(code ?? 1);
    }
  });
  child.on('error', (err) => {
    console.error(`[dev] ${name} failed to start:`, err.message);
    shutdown(1);
  });
  return child;
}

async function waitForServer(url, timeoutMs = 45000) {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not ready yet */
    }
    if (Date.now() - started > timeoutMs) throw new Error(`dev server at ${url} did not start`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => shutdown(0));
}

async function main() {
  run('main:watch', process.execPath, [path.join(root, 'scripts/build-main.mjs'), '--watch']);
  run('renderer', process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js')], {
    DROIDBRIDGE_DEV: '1',
  });
  await waitForServer(devServerUrl);
  console.log(`[dev] renderer ready at ${devServerUrl}, launching Electron…`);
  run('electron', electronPath, ['.'], {
    DROIDBRIDGE_DEV_SERVER_URL: devServerUrl,
    NODE_ENV: 'development',
  });
}

main().catch((err) => {
  console.error('[dev]', err);
  shutdown(1);
});
