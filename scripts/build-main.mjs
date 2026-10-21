import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // electron-updater must stay external: it resolves app-update.yml at
  // runtime from the packaged resources, which bundling would break.
  external: ['electron', 'electron-updater'],
  logLevel: 'info',
  sourcemap: dev,
  minify: !dev,
};

const targets = [
  {
    entryPoints: [path.join(root, 'src/main/index.ts')],
    outfile: path.join(root, 'dist/main/main.js'),
  },
  {
    entryPoints: [path.join(root, 'src/preload/index.ts')],
    outfile: path.join(root, 'dist/preload/preload.cjs'),
  },
];

async function main() {
  if (watch) {
    const contexts = await Promise.all(targets.map((t) => esbuild.context({ ...common, ...t })));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('[build-main] watching…');
  } else {
    await Promise.all(targets.map((t) => esbuild.build({ ...common, ...t })));
    console.log('[build-main] done');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
