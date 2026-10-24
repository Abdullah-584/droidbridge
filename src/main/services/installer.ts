import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { findTool } from '../adb/locate';
import { runCommand, type RunOptions, type RunResult } from '../adb/run';
import { DroidBridgeError } from '../errors';
import type { InstallProgress, ToolName } from '../../shared/types';

/**
 * Automatic tool installation.
 *
 * Two strategies:
 *  - **adb / scrcpy** — official zip archives (Google / Genymobile releases)
 *    downloaded over HTTPS, extracted with the Windows `tar` and installed
 *    into a managed per-user directory (`%LOCALAPPDATA%\DroidBridge\tools`).
 *    No admin rights, no shell, no installer wizard.
 *  - **flutter / code** — installed through `winget` on an explicit user
 *    click (Flutter is a multi-GB download; it never auto-pulls).
 *
 * Every transition is reported on the `tools:install-progress` channel so the
 * renderer can show live percent and refresh the toolchain card on `done`.
 */

/** Official platform-tools archive (same URL the CI installs). */
export const PLATFORM_TOOLS_URL = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip';
/** GitHub API endpoint used to resolve the latest scrcpy win64 asset. */
export const SCRCPY_LATEST_API = 'https://api.github.com/repos/Genymobile/scrcpy/releases/latest';

/** winget package ids (exact match, `-e`) for the click-to-install tools. */
export const WINGET_IDS: Partial<Record<ToolName, string>> = {
  flutter: 'Google.Flutter',
  code: 'Microsoft.VisualStudioCode',
};

const SCRCPY_ASSET_RE = /^scrcpy-win64-v\d+\.\d+\.\d+\.zip$/;
const USER_AGENT = 'DroidBridge (+https://github.com/Abdullah-584/droidbridge)';

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** Managed tools root: `%LOCALAPPDATA%\DroidBridge\tools` (homedir fallback). */
export function toolsRoot(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.LOCALAPPDATA ?? env.USERPROFILE ?? env.HOME ?? os.homedir();
  return path.join(base, 'DroidBridge', 'tools');
}

/**
 * Picks the win64 zip asset out of a parsed GitHub release payload.
 * Throws an honest error when the release shape is unexpected — nothing is
 * guessed and no URL is assembled from untrusted fragments.
 */
export function pickScrcpyAsset(release: unknown): string {
  const assets = (release as { assets?: unknown })?.assets;
  if (!Array.isArray(assets)) {
    throw new DroidBridgeError('INSTALL_SOURCE_ERROR', 'Unexpected response from the scrcpy release feed.');
  }
  for (const asset of assets) {
    const name = (asset as { name?: unknown })?.name;
    const url = (asset as { browser_download_url?: unknown })?.browser_download_url;
    if (typeof name === 'string' && SCRCPY_ASSET_RE.test(name) && typeof url === 'string') {
      return url;
    }
  }
  throw new DroidBridgeError('INSTALL_SOURCE_ERROR', 'No Windows x64 scrcpy archive in the latest release.');
}

/** argv for a silent winget install (a single argv array — never a shell line). */
export function wingetInstallArgs(tool: ToolName): string[] {
  const id = WINGET_IDS[tool];
  if (!id) {
    throw new DroidBridgeError('INSTALL_UNSUPPORTED', `DroidBridge cannot install "${tool}" automatically.`);
  }
  return [
    'install',
    '--id',
    id,
    '-e',
    '--silent',
    '--accept-source-agreements',
    '--accept-package-agreements',
    '--disable-interactivity',
  ];
}

/** Finds `fileName` under `root` (bounded depth) — used to locate extracted binaries. */
export function findFileRecursive(root: string, fileName: string, maxDepth = 4): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return full;
    if (entry.isDirectory() && maxDepth > 1) {
      const found = findFileRecursive(full, fileName, maxDepth - 1);
      if (found) return found;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Production network / extraction implementations (injectable in tests)
// ---------------------------------------------------------------------------

function httpGet(urlStr: string, redirectsLeft: number): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(urlStr);
    } catch {
      reject(new DroidBridgeError('INSTALL_SOURCE_ERROR', `Invalid download URL.`));
      return;
    }
    const mod = url.protocol === 'http:' ? http : https;
    const req = mod.get(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': '*/*' } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(new DroidBridgeError('INSTALL_SOURCE_ERROR', 'Too many redirects while downloading.'));
          return;
        }
        httpGet(new URL(res.headers.location, url).toString(), redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new DroidBridgeError('INSTALL_SOURCE_ERROR', `Download failed (HTTP ${status}).`));
        return;
      }
      resolve(res);
    });
    req.setTimeout(30_000, () => {
      req.destroy(new DroidBridgeError('INSTALL_SOURCE_ERROR', 'Download timed out after 30s without data.'));
    });
    req.on('error', reject);
  });
}

/** Streams `url` to `dest`, reporting `(received, total)` at most every 200 ms. */
export async function downloadFile(
  url: string,
  dest: string,
  onProgress: (received: number, total: number | null) => void,
): Promise<void> {
  const res = await httpGet(url, 5);
  const total = Number(res.headers['content-length']) || null;
  await new Promise<void>((resolve, reject) => {
    let received = 0;
    let lastEmit = 0;
    let settled = false;
    const fail = (err: unknown): void => {
      if (settled) return;
      settled = true;
      fs.rmSync(dest, { force: true });
      reject(err);
    };
    const out = fs.createWriteStream(dest);
    res.on('data', (chunk: Buffer) => {
      received += chunk.length;
      const now = Date.now();
      if (now - lastEmit >= 200) {
        lastEmit = now;
        onProgress(received, total);
      }
    });
    res.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => {
      if (settled) return;
      settled = true;
      onProgress(received, total);
      resolve();
    });
    res.pipe(out);
  });
}

/** Fetches a small text/JSON resource (release feeds) with a hard size cap. */
export async function fetchText(url: string, maxBytes = 512 * 1024): Promise<string> {
  const res = await httpGet(url, 5);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res) {
    const buf = Buffer.from(chunk as Buffer);
    size += buf.length;
    if (size > maxBytes) {
      throw new DroidBridgeError('INSTALL_SOURCE_ERROR', 'Response too large from download source.');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The bsdtar that ships with Windows (`System32\tar.exe`) reads zip archives
 * natively — but shells launched from Git/MSYS put GNU tar earlier on PATH and
 * GNU tar rejects zip. Resolve the absolute Windows path first, fall back to
 * `tar` (bsdtar on every other platform).
 */
export function bsdtarPath(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform !== 'win32') return 'tar';
  const systemRoot = env.SystemRoot ?? env.WINDIR ?? 'C:\\Windows';
  const systemTar = path.join(systemRoot, 'System32', 'tar.exe');
  return fs.existsSync(systemTar) ? systemTar : 'tar';
}

/**
 * Extracts a zip with the Windows bsdtar. Arguments are a fixed array — no
 * shell is involved.
 */
export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const result = await runCommand(bsdtarPath(), ['-xf', zipPath, '-C', destDir], {
    timeoutMs: 120_000,
    maxOutputBytes: 512 * 1024,
  });
  if (result.code !== 0 || result.killed || result.timedOut) {
    throw new DroidBridgeError(
      'EXTRACT_FAILED',
      result.stderr.trim() || result.stdout.trim() || 'The downloaded archive could not be extracted.',
    );
  }
}

// ---------------------------------------------------------------------------
// Installer
// ---------------------------------------------------------------------------

export interface InstallerDeps {
  env?: NodeJS.ProcessEnv;
  /** Managed tools root; defaults to `toolsRoot(env)` (tests point it at a temp dir). */
  root?: string;
  download?: (url: string, dest: string, onProgress: (received: number, total: number | null) => void) => Promise<void>;
  fetchText?: (url: string) => Promise<string>;
  extract?: (zipPath: string, destDir: string) => Promise<void>;
  run?: (bin: string, argv: readonly string[], opts?: RunOptions) => Promise<RunResult>;
  /** Tool discovery used by auto-install; defaults to the real `findTool`. */
  locate?: (tool: ToolName) => { path: string | null };
}

export interface ToolInstaller {
  /** Installs one tool (single-flight); emits progress and rejects on failure. */
  install(tool: ToolName): Promise<void>;
  /** First-launch pass: installs adb + scrcpy when they are missing. */
  autoInstallMissing(): Promise<void>;
}

const AUTO_TOOLS: readonly ToolName[] = ['adb', 'scrcpy'];

function exeName(tool: ToolName): string {
  return tool === 'adb' ? 'adb.exe' : 'scrcpy.exe';
}

function versionArgs(tool: ToolName): readonly string[] {
  return tool === 'adb' ? ['version'] : ['--version'];
}

export function createToolInstaller(
  emit: (progress: InstallProgress) => void,
  deps: InstallerDeps = {},
): ToolInstaller {
  const env = deps.env ?? process.env;
  const root = deps.root ?? toolsRoot(env);
  const download = deps.download ?? downloadFile;
  const fetchTextImpl = deps.fetchText ?? fetchText;
  const extract = deps.extract ?? extractZip;
  const run = deps.run ?? runCommand;
  const locate = deps.locate ?? ((tool: ToolName) => findTool(tool, env));
  const inflight = new Map<ToolName, Promise<void>>();

  const report = (progress: InstallProgress): void => {
    try {
      emit(progress);
    } catch {
      /* a closed window must never abort an install */
    }
  };

  async function resolveScrcpyUrl(): Promise<string> {
    const release: unknown = JSON.parse(await fetchTextImpl(SCRCPY_LATEST_API));
    return pickScrcpyAsset(release);
  }

  /** Downloads a zip tool into staging, verifies it, then swaps it into place. */
  async function installZipTool(tool: ToolName): Promise<void> {
    const url = tool === 'adb' ? PLATFORM_TOOLS_URL : await resolveScrcpyUrl();
    const staging = path.join(root, '.staging', `${tool}-${Date.now()}-${process.pid}`);
    fs.mkdirSync(staging, { recursive: true });

    try {
      const zipPath = path.join(staging, 'download.zip');
      report({ tool, phase: 'downloading', percent: 0 });
      await download(url, zipPath, (received, total) => {
        const percent = total && total > 0 ? Math.min(99, Math.floor((received / total) * 100)) : 0;
        report({ tool, phase: 'downloading', percent });
      });

      report({ tool, phase: 'extracting', percent: 0 });
      await extract(zipPath, staging);

      report({ tool, phase: 'verifying', percent: 0 });
      const extractedExe = findFileRecursive(staging, exeName(tool));
      if (!extractedExe) {
        throw new DroidBridgeError('INSTALL_VERIFY_FAILED', `The downloaded ${tool} archive did not contain ${exeName(tool)}.`);
      }

      const target = path.join(root, tool === 'adb' ? 'platform-tools' : 'scrcpy');
      const home = path.dirname(extractedExe);
      fs.rmSync(target, { recursive: true, force: true });
      if (path.resolve(home) === path.resolve(staging)) {
        // Flat archive: move the whole staging dir into place.
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(staging, target);
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(home, target);
      }

      const finalExe = path.join(target, path.basename(extractedExe));
      const probe = await run(finalExe, versionArgs(tool), { timeoutMs: 15_000, maxOutputBytes: 64 * 1024 });
      if (probe.code !== 0 || probe.killed) {
        throw new DroidBridgeError(
          'INSTALL_VERIFY_FAILED',
          `${path.basename(finalExe)} was installed but failed to run (exit ${probe.code ?? 'n/a'}).`,
        );
      }
      report({ tool, phase: 'done', percent: 100 });
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  async function installViaWinget(tool: ToolName): Promise<void> {
    const args = wingetInstallArgs(tool);
    report({ tool, phase: 'installing', percent: 0, message: `winget ${args.slice(0, 4).join(' ')}…` });
    const timeoutMs = tool === 'flutter' ? 30 * 60_000 : 10 * 60_000;
    let result: RunResult;
    try {
      result = await run('winget', args, { timeoutMs, maxOutputBytes: 1024 * 1024 });
    } catch (e) {
      throw new DroidBridgeError(
        'WINGET_NOT_FOUND',
        e instanceof Error ? e.message : 'winget could not be started on this machine.',
      );
    }
    if (result.timedOut) {
      throw new DroidBridgeError('INSTALL_FAILED', `winget timed out after ${Math.round(timeoutMs / 60_000)} minutes.`);
    }
    if (result.code !== 0) {
      const tail = `${result.stdout}\n${result.stderr}`
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(-3)
        .join(' — ');
      throw new DroidBridgeError('INSTALL_FAILED', tail || `winget exited with code ${result.code ?? 'n/a'}.`);
    }
    report({ tool, phase: 'done', percent: 100 });
  }

  function install(tool: ToolName): Promise<void> {
    const existing = inflight.get(tool);
    if (existing) return existing;

    const job = (async (): Promise<void> => {
      try {
        if (tool === 'flutter' || tool === 'code') {
          await installViaWinget(tool);
        } else {
          await installZipTool(tool);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        report({ tool, phase: 'error', percent: 0, message });
        if (e instanceof DroidBridgeError) throw e;
        throw new DroidBridgeError('INSTALL_FAILED', message);
      } finally {
        inflight.delete(tool);
      }
    })();

    inflight.set(tool, job);
    return job;
  }

  async function autoInstallMissing(): Promise<void> {
    for (const tool of AUTO_TOOLS) {
      try {
        if (!locate(tool).path) await install(tool);
      } catch {
        /* progress already reported with an honest error */
      }
    }
  }

  return { install, autoInstallMissing };
}
