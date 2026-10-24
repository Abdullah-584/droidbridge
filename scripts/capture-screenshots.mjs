#!/usr/bin/env node
/**
 * Capture README screenshots from a running DroidBridge instance.
 *
 * Starts the app with a CDP port, then walks the real UI (dashboard,
 * devices + diagnostics, logcat, pairing, tools) and saves PNGs into
 * docs/screenshots/. Requires a real device/emulator for populated shots.
 *
 * Usage:
 *   node_modules/electron/dist/electron.exe . --remote-debugging-port=9223 &
 *   node scripts/capture-screenshots.mjs
 */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.DROIDBRIDGE_CDP_PORT ?? '9223';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'docs', 'screenshots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page' && t.url.includes('dist/renderer'));
  if (!page) throw new Error(`no renderer target on port ${PORT} — is the app running?`);
  return page;
}

class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', () => reject(new Error('CDP websocket failed')), { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(`${entry.method}: ${msg.error.message}`));
      else entry.resolve(msg.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) {
      throw new Error(`evaluate failed: ${exceptionDetails.text ?? JSON.stringify(exceptionDetails)}`);
    }
    return result.value;
  }

  async waitFor(expression, { timeoutMs = 20_000, intervalMs = 250, label } = {}) {
    const started = Date.now();
    for (;;) {
      if (await this.evaluate(expression)) return;
      if (Date.now() - started > timeoutMs) {
        throw new Error(`timeout waiting for ${label ?? expression}`);
      }
      await sleep(intervalMs);
    }
  }

  async clickButton(text, scope = 'main') {
    const clicked = await this.evaluate(`(() => {
      const scope = document.querySelector('${scope}') ?? document;
      const buttons = [...scope.querySelectorAll('button')];
      const norm = (b) => b.textContent.replace(/\\s+/g, ' ').trim();
      // Sidebar items append a count badge ("Devices1"), so fall back to prefix match.
      const btn = buttons.find((b) => norm(b) === ${JSON.stringify(text)})
        ?? buttons.find((b) => norm(b).startsWith(${JSON.stringify(text)}));
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`button "${text}" not found in ${scope}`);
  }

  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    const file = path.join(OUT_DIR, `${name}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    const size = (await stat(file)).size;
    console.log(`saved ${path.relative(ROOT, file)} (${(size / 1024).toFixed(0)} KB)`);
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const target = await findTarget();
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // App shell + real data populated.
  await cdp.waitFor(`document.querySelectorAll('nav[aria-label="Main navigation"] button').length === 5`, {
    label: 'sidebar',
  });
  // Never assume the current view — the window is on a live desktop.
  await cdp.clickButton('Dashboard', 'nav');
  await cdp.waitFor(`document.body.innerText.includes('Connected devices')`, { label: 'dashboard view' });
  const hasDevice = await cdp
    .waitFor(`document.body.innerText.includes('1 connected')`, { timeoutMs: 30_000, label: 'connected device' })
    .then(() => true)
    .catch(() => false);
  if (!hasDevice) console.warn('warning: no device detected — screenshots will show empty states');
  await cdp.waitFor(
    `document.body.innerText.includes('Toolchain') && /Ready|Missing/.test(document.body.innerText)`,
    { label: 'toolchain rows' },
  );
  await sleep(600);
  await cdp.shot('dashboard');

  // Devices: inspector + real diagnostics run.
  await cdp.clickButton('Devices', 'nav');
  await cdp.waitFor(`/identity/i.test(document.body.innerText)`, { label: 'device inspector' });
  await cdp.waitFor(`!document.body.innerText.includes('Loading…')`, { label: 'details loaded' }).catch(() => {});
  await cdp.clickButton('Run diagnostics');
  await cdp.waitFor(`document.body.innerText.includes('PASS') || document.body.innerText.includes('FAIL')`, {
    timeoutMs: 45_000,
    label: 'diagnostics results',
  });
  await sleep(400);
  await cdp.shot('devices');

  // Logcat: start a real stream and wait for lines.
  await cdp.clickButton('Logcat', 'nav');
  await cdp.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Start')`, {
    label: 'logcat start button',
  });
  await cdp.clickButton('Start');
  await cdp.waitFor(
    `(() => { const m = document.body.innerText.match(/^(\\d+) lines/m); return m ? Number(m[1]) >= 40 : false; })()`,
    { timeoutMs: 30_000, label: 'logcat lines streaming' },
  );
  await sleep(500);
  await cdp.shot('logcat');

  // Pairing: guided USB + wireless flows.
  await cdp.clickButton('Pairing', 'nav');
  await cdp.waitFor(`document.body.innerText.match(/wireless|pair/i)`, { label: 'pairing view' });
  await sleep(400);
  await cdp.shot('pairing');

  // Tools: Flutter / VS Code / scrcpy status, with a real `flutter doctor -v` run.
  await cdp.clickButton('Tools', 'nav');
  await cdp.waitFor(`document.body.innerText.match(/Flutter|scrcpy|VS Code/i)`, { label: 'tools view' });
  await cdp.clickButton('flutter doctor -v').catch(() => console.warn('skip: flutter doctor button not found'));
  await cdp
    .waitFor(`document.body.innerText.match(/Android toolchain|Doctor summary/i)`, {
      timeoutMs: 90_000,
      label: 'flutter doctor output',
    })
    .catch((e) => console.warn(String(e)));
  await sleep(400);
  await cdp.shot('tools');

  cdp.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
