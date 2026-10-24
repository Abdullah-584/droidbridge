#!/usr/bin/env node
/**
 * Post-publish release guard (runs in CI after electron-builder finishes).
 *
 * electron-builder uploads assets in parallel and can race its own
 * "release already exists" check, producing TWO release objects for one tag
 * with assets split between them (observed on v1.0.1 — `/releases/latest`
 * then resolves to the incomplete one and updaters 404 on latest.yml).
 *
 * This script proves the published state instead of assuming it:
 *   1. exactly one release exists for `v<package.json version>`
 *      (split duplicates are repaired: missing assets copied over, then the
 *      empty duplicate deleted — only with a token, never silently)
 *   2. the canonical release holds exe + blockmap + latest.yml
 *   3. latest.yml parses, its version matches, and its size equals the
 *      uploaded exe's byte size
 *
 * Usage:
 *   node scripts/verify-release.mjs            # CI: verify, repair if needed
 *   node scripts/verify-release.mjs --check    # local: read-only diagnosis
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { execSync } from 'node:child_process';

const CHECK_ONLY = process.argv.includes('--check');
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null;
const API = 'https://api.github.com';
const UA = 'DroidBridge-release-guard (+https://github.com/Abdullah-584/droidbridge)';

const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const tag = `v${version}`;
const exeName = `DroidBridge-Setup-${version}-x64.exe`;
const blockmapName = `${exeName}.blockmap`;

const log = (msg) => console.log(`• ${msg}`);
const fail = (msg) => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};

function repoFromEnvOrGit() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const url = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
    const m = url.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
    if (m) return m[1];
  } catch {
    /* fall through */
  }
  return null;
}

/** HTTP request with optional API auth; returns status + Buffer body. */
function request(urlStr, { auth = false, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const headers = { 'User-Agent': UA, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (auth && TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
    const transport = url.protocol === 'http:' ? http : https;
    const req = transport.request(
      url,
      { method, headers },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          // Never forward the API token across hosts (release asset CDNs).
          const next = new URL(res.headers.location, url).toString();
          resolve(request(next, { auth: auth && new URL(next).host === url.host, method }));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function api(pathname, opts = {}) {
  const res = await request(`${API}${pathname}`, { ...opts, auth: true });
  return res;
}

async function json(res) {
  try {
    return JSON.parse(res.body.toString('utf8'));
  } catch {
    return null;
  }
}

async function downloadPublic(url) {
  const res = await request(url);
  if (res.status !== 200) throw new Error(`download failed (HTTP ${res.status})`);
  return res.body;
}

async function uploadAsset(releaseId, name, buf) {
  const res = await request(
    `${API}/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
    { auth: true, method: 'POST' },
  );
  if (res.status !== 201) {
    throw new Error(`asset upload for "${name}" failed (HTTP ${res.status}): ${res.body.toString('utf8').slice(0, 300)}`);
  }
}

async function deleteRelease(releaseId) {
  const res = await api(`/repos/${repo}/releases/${releaseId}`, { method: 'DELETE' });
  if (res.status !== 204) throw new Error(`release delete failed (HTTP ${res.status})`);
}

const repo = repoFromEnvOrGit();
if (!repo) fail('cannot determine the GitHub repository (set GITHUB_REPOSITORY or a git remote).');

const releasesRes = await api(`/repos/${repo}/releases?per_page=100`);
if (releasesRes.status !== 200) {
  fail(`list releases failed (HTTP ${releasesRes.status})${TOKEN ? '' : ' — anonymous access denied?'}`);
}
const releases = (await json(releasesRes)) ?? [];
const matching = releases.filter((r) => r.tag_name === tag);
if (matching.length === 0) fail(`no release exists for tag ${tag}.`);
if (matching.length === 1) {
  log(`single release found for ${tag} (id ${matching[0].id})`);
} else {
  log(`DUPLICATE: ${matching.length} releases exist for ${tag} — repairing`);
  // Canonical = the one holding latest.yml (the updater's lifeline), else the fullest.
  const canonical =
    matching.find((r) => r.assets?.some((a) => a.name === 'latest.yml')) ??
    [...matching].sort((a, b) => (b.assets?.length ?? 0) - (a.assets?.length ?? 0))[0];
  const duplicates = matching.filter((r) => r.id !== canonical.id);

  for (const dupe of duplicates) {
    const missing = (dupe.assets ?? []).filter(
      (a) => !(canonical.assets ?? []).some((c) => c.name === a.name),
    );
    if (CHECK_ONLY || !TOKEN) {
      fail(
        `duplicate release ${dupe.id} would need repair (${missing.map((a) => a.name).join(', ') || 'no missing assets'}); ` +
          `run with GH_TOKEN to repair, or fix manually.`,
      );
    }
    for (const asset of missing) {
      const buf = await downloadPublic(asset.browser_download_url);
      await uploadAsset(canonical.id, asset.name, buf);
      log(`copied "${asset.name}" from duplicate ${dupe.id} → ${canonical.id}`);
    }
    await deleteRelease(dupe.id);
    log(`deleted duplicate release ${dupe.id}`);
  }
}

// Re-resolve the canonical release with its final asset list.
const listAgain = await json(await api(`/repos/${repo}/releases?per_page=100`));
const canonical = (listAgain ?? []).find((r) => r.tag_name === tag);
if (!canonical) fail(`release for ${tag} disappeared during verification.`);
if ((listAgain ?? []).filter((r) => r.tag_name === tag).length !== 1) {
  fail(`still more than one release for ${tag} after repair.`);
}

const assetNames = (canonical.assets ?? []).map((a) => a.name);
for (const required of [exeName, blockmapName, 'latest.yml']) {
  if (!assetNames.includes(required)) fail(`release ${tag} is missing asset "${required}" (has: ${assetNames.join(', ')}).`);
}
log(`all required assets present: ${exeName}, ${blockmapName}, latest.yml`);

const exeAsset = canonical.assets.find((a) => a.name === exeName);
const ymlAsset = canonical.assets.find((a) => a.name === 'latest.yml');
if (exeAsset.state !== 'uploaded') fail(`exe asset state is "${exeAsset.state}", expected "uploaded".`);

let manifest;
try {
  manifest = (await downloadPublic(ymlAsset.browser_download_url)).toString('utf8');
} catch (e) {
  fail(`latest.yml could not be downloaded: ${e.message}`);
}

const manifestVersion = /^version:\s*(\S+)/m.exec(manifest)?.[1];
if (manifestVersion !== version) fail(`latest.yml says version "${manifestVersion}", expected "${version}".`);

const sizeMatch = new RegExp(
  `url:\\s*${exeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?size:\\s*(\\d+)`,
).exec(manifest);
if (!sizeMatch) fail(`latest.yml has no size entry for ${exeName}.`);
const manifestSize = Number(sizeMatch[1]);
if (manifestSize !== exeAsset.size) {
  fail(`latest.yml size ${manifestSize} ≠ uploaded exe size ${exeAsset.size} — clients would reject the download.`);
}

log(
  `latest.yml verified: version ${version}, size ${manifestSize} B matches the exe asset ` +
    `(tag ${tag}, release id ${canonical.id}, draft=${canonical.draft}, prerelease=${canonical.prerelease})`,
);
log(`release ${tag} is single, complete and self-consistent.`);
