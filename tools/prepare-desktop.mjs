import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, nodePlatform, pnpmCommand } from './platform.mjs';

function pnpm(args) {
  const [command, commandArgs] = pnpmCommand(args);
  execFileSync(command, commandArgs, { cwd: REPO, stdio: 'inherit' });
}

// Tauri requires the sidecar and resource directory even for a fresh dev build.
// Release builds always rebuild both, so stale local artifacts cannot ship.
const dev = process.argv.includes('--dev');
const host = /^host:\s*(.+)$/m.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }))?.[1].trim();
if (!host) throw new Error('Could not determine the Rust host target.');
const binary = join(REPO, `apps/overlay/src-tauri/binaries/lr-server-${host}${nodePlatform().extension}`);
if (!dev || !existsSync(join(REPO, 'apps/student/dist/index.html'))) {
  pnpm(['-F', '@lr/student', 'build']);
}
if (!dev || !existsSync(binary)) {
  execFileSync(process.execPath, [join(REPO, 'tools/build-server-binary.mjs')], { cwd: REPO, stdio: 'inherit' });
}
if (!dev) pnpm(['-F', '@lr/overlay', 'build']);
