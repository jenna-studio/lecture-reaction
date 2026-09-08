#!/usr/bin/env node
/**
 * Builds the realtime server into a single self-contained executable, so the
 * desktop app can ship it and a professor never has to install Node.
 *
 *   esbuild  -> one CJS file
 *   node SEA -> a blob of that file
 *   postject -> the blob injected into a copy of the node binary
 *   codesign -> macOS refuses to run a patched binary otherwise
 *
 * The output is named for Tauri's sidecar convention:
 *   binaries/lr-server-<rust target triple>
 */

import { execFileSync } from 'node:child_process';
import {
  mkdirSync, copyFileSync, writeFileSync, rmSync, existsSync, statSync, chmodSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { nodePlatform, packageCli } from './platform.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(REPO, 'apps/overlay/src-tauri/binaries');
const WORK = join(REPO, 'apps/overlay/src-tauri/.sea');
const CACHE = join(REPO, 'tools/.cache');

/**
 * SEA injection needs a base `node` that contains the fuse sentinel. Builds
 * from a package manager often do not: Homebrew's node, for instance, has zero
 * occurrences of it, and postject fails with "could not find the sentinel".
 * So an official build is downloaded once and cached.
 */
const NODE_VERSION = 'v22.14.0';

const run = (cmd, args, opts = {}) => {
  try {
    return execFileSync(cmd, args, { stdio: 'inherit', cwd: REPO, ...opts });
  } catch (err) {
    // execFileSync's own message buries which step failed.
    throw new Error(`step failed: ${cmd} ${args.join(' ')}\n${err.message}`);
  }
};

/** The Rust target triple Tauri expects in the sidecar filename. */
function targetTriple() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const host = /^host:\s*(.+)$/m.exec(out)?.[1];
  if (!host) throw new Error('could not read host triple from `rustc -vV`');
  return host.trim();
}

/** Returns a path to an official node binary that supports SEA injection. */
async function officialNode(platform = process.platform, architecture = process.arch) {
  const { arch, os, extension } = nodePlatform(platform, architecture);
  const name = `node-${NODE_VERSION}-${os}-${arch}`;
  const cached = join(CACHE, name, 'bin', `node${extension}`);
  if (existsSync(cached)) return cached;

  mkdirSync(CACHE, { recursive: true });
  const url = os === 'win'
    ? `https://nodejs.org/dist/${NODE_VERSION}/win-${arch}/node.exe`
    : `https://nodejs.org/dist/${NODE_VERSION}/${name}.tar.gz`;
  console.log(`      fetching ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Node download failed: HTTP ${response.status} (${url})`);
  const downloaded = Buffer.from(await response.arrayBuffer());
  if (os === 'win') {
    mkdirSync(dirname(cached), { recursive: true });
    writeFileSync(cached, downloaded);
  } else {
    const archive = join(CACHE, `${name}.tar.gz`);
    writeFileSync(archive, downloaded);
    run('tar', ['-xzf', archive, '-C', CACHE]);
    rmSync(archive, { force: true });
  }
  if (!existsSync(cached)) throw new Error(`extracted archive has no ${cached}`);
  return cached;
}

const host = targetTriple();
const triple = process.env.LR_BUILD_TARGET || process.env.TAURI_ENV_TARGET_TRIPLE || host;
const crossWindows = triple === 'x86_64-pc-windows-msvc' && host !== triple;
if (triple !== host && !crossWindows) throw new Error(`Unsupported cross-build target: ${triple}`);
const expectedArch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
if (!host.startsWith(`${expectedArch}-`)) throw new Error('Node and the Rust host must use the same architecture.');
const extension = triple.includes('windows') ? '.exe' : '';
const outFile = join(OUT_DIR, `lr-server-${triple}${extension}`);

mkdirSync(OUT_DIR, { recursive: true });
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

console.log('[1/4] bundling server -> single file');
const require = createRequire(new URL('../packages/server/package.json', import.meta.url));
await require('esbuild').build({
  entryPoints: [join(REPO, 'packages/server/src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // `ws` optionally requires these native speedups; the pure-JS fallback is fine.
  external: ['bufferutil', 'utf-8-validate'],
  outfile: join(WORK, 'server.cjs'),
});

// The blob is version-locked to the node that produced it: generating with the
// system node and injecting into a different build fails at startup with
// "v8::ToLocalChecked Empty MaybeLocal". Use one node for both steps.
const baseNode = await officialNode();

console.log('[2/4] generating SEA blob');
writeFileSync(
  join(WORK, 'sea-config.json'),
  JSON.stringify({
    main: join(WORK, 'server.cjs'),
    output: join(WORK, 'server.blob'),
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    useSnapshot: false,
  }),
);
run(baseNode, ['--experimental-sea-config', join(WORK, 'sea-config.json')]);

console.log('[3/4] injecting into a copy of the node binary');
// The node binary is mode 555, so a previous run leaves an unwritable file
// here and copyFileSync would fail with EACCES.
rmSync(outFile, { force: true });
copyFileSync(crossWindows ? await officialNode('win32', 'x64') : baseNode, outFile);
chmodSync(outFile, 0o755);
if (process.platform === 'darwin' && !crossWindows) {
  // The copied binary carries Node's signature, which no longer matches once
  // the blob is injected. Strip it now and re-sign after.
  run('codesign', ['--remove-signature', outFile]);
}
run(process.execPath, [packageCli('postject', 'postject'),
  outFile,
  'NODE_SEA_BLOB',
  join(WORK, 'server.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(process.platform === 'darwin' && !crossWindows ? ['--macho-segment-name', 'NODE_SEA'] : []),
]);
if (process.platform === 'darwin' && !crossWindows) {
  run('codesign', ['--sign', '-', outFile]);
}

rmSync(WORK, { recursive: true, force: true });

if (!existsSync(outFile)) throw new Error('sidecar was not produced');
console.log(
  `[4/4] done: ${outFile.replace(REPO + '/', '')} ` +
  `(${(statSync(outFile).size / 1e6).toFixed(0)} MB)`,
);
