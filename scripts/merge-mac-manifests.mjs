#!/usr/bin/env node
/**
 * Merges per-arch macOS update manifests into a single latest-mac.yml.
 *
 * CI builds the arm64 and x64 zips on separate runners, so each job emits its
 * own latest-mac.yml covering only its own zip. electron-updater's MacUpdater
 * picks the right asset by looking for 'arm64' in files[].url (anything else
 * is treated as x64), so a release serves both architectures from ONE merged
 * manifest — exactly what a single multi-arch electron-builder invocation
 * would have produced. Publishing the two manifests separately would let one
 * overwrite the other and break updates for one architecture.
 *
 * Usage: node scripts/merge-mac-manifests.mjs <arm64.yml> <x64.yml> <out.yml>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loadYaml(file) {
  let yaml;
  try {
    yaml = require('js-yaml');
  } catch {
    console.error('js-yaml is required: npm install --no-save js-yaml');
    process.exit(2);
  }
  try {
    return yaml.load(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(`cannot read ${file}: ${err.message}`);
  }
}

function fail(message) {
  console.error(`merge-mac-manifests: ${message}`);
  process.exit(1);
}

const [arm64File, x64File, outFile] = process.argv.slice(2);
if (!arm64File || !x64File || !outFile) {
  fail('usage: merge-mac-manifests.mjs <arm64.yml> <x64.yml> <out.yml>');
}

const arm64 = loadYaml(arm64File);
const x64 = loadYaml(x64File);

for (const [name, manifest] of [
  [arm64File, arm64],
  [x64File, x64],
]) {
  if (!manifest || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    fail(`${name} has no files[] entries`);
  }
  for (const entry of manifest.files) {
    if (!entry.url || !entry.sha512 || typeof entry.size !== 'number') {
      fail(`${name} has an incomplete files[] entry: ${JSON.stringify(entry)}`);
    }
  }
}

const arm64Urls = arm64.files.map((f) => f.url);
const x64Urls = x64.files.map((f) => f.url);
if (arm64Urls.some((url) => x64Urls.includes(url))) {
  fail('manifests share a file url — refusing to merge');
}

// Base on the arm64 manifest (its version/path/sha512 describe the arm64 zip;
// MacUpdater ignores the top-level fields and filters files[] by arch).
const merged = { ...arm64, files: [...arm64.files, ...x64.files] };

fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
fs.writeFileSync(outFile, require('js-yaml').dump(merged, { lineWidth: -1 }));

console.log(`merged ${arm64File} + ${x64File} -> ${outFile}`);
for (const entry of merged.files) {
  console.log(`  ${entry.url} (${entry.size} bytes)`);
}
