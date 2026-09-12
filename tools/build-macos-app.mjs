import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, pnpmCommand } from './platform.mjs';

// One app for every Mac: Tauri lipos the Rust binary, and the sidecar is joined below.
const target = 'universal-apple-darwin';
const env = { ...process.env, LR_BUILD_TARGET: target };
const run = (command, args, cwd = REPO) => execFileSync(command, args, { cwd, env, stdio: 'inherit' });
const pnpm = (args) => { const [cmd, argv] = pnpmCommand(args); run(cmd, argv); };
if (process.platform !== 'darwin') throw new Error('A macOS app can only be built on macOS.');
pnpm(['-F', '@lr/student', 'build']);
pnpm(['-F', '@lr/overlay', 'build']);
run(process.execPath, [join(REPO, 'tools/build-server-binary.mjs')]);
// Preparation is done above, so Tauri's own beforeBuildCommand would only repeat
// it — and it would build a host-only sidecar over the universal one.
pnpm(['tauri', 'build', '--target', target, '--bundles', 'app',
  '--config', JSON.stringify({ build: { beforeBuildCommand: '' } })]);

const name = 'Lecture-React-macOS-Universal';
const app = 'Lecture React.app';
const built = join(REPO, 'apps/overlay/src-tauri/target', target, 'release/bundle/macos', app);
if (!existsSync(built)) throw new Error(`Tauri did not produce ${built}`);
const output = join(REPO, 'dist', name);
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(built, join(output, app), { recursive: true, verbatimSymlinks: true });

const bundled = join(output, app);
// Tauri copies one architecture's sidecar into the bundle, so swap in the
// combined binary: a thin server would strand half the Macs this app runs on.
cpSync(join(REPO, `apps/overlay/src-tauri/binaries/lr-server-${target}`), join(bundled, 'Contents/MacOS/lr-server'));
// `lipo` on the main binary invalidates whatever signature the slices carried, and
// an arm64 Mac refuses to launch code that is not signed at all. Ad-hoc is enough
// for an app the professor copies over themselves; it is not notarized.
run('xattr', ['-cr', bundled]);
run('codesign', ['--force', '--deep', '--sign', '-', bundled]);
run('codesign', ['--verify', '--deep', '--strict', bundled]);
const executable = execFileSync('/usr/libexec/PlistBuddy',
  ['-c', 'Print :CFBundleExecutable', join(bundled, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
for (const binary of [executable, 'lr-server']) {
  const archs = execFileSync('lipo', ['-archs', join(bundled, 'Contents/MacOS', binary)], { encoding: 'utf8' }).trim();
  if (!archs.includes('arm64') || !archs.includes('x86_64')) {
    throw new Error(`${binary} is not universal: ${archs}`);
  }
}
if (!existsSync(join(bundled, 'Contents/Resources/student/index.html'))) {
  throw new Error('the student app is missing from the bundle');
}

writeFileSync(join(output, 'READ ME.txt'), `LECTURE REACT - MACOS EDITION

1. Drag "Lecture React.app" anywhere you like: Applications, the Desktop,
   an external drive. It is one self-contained app with nothing to install.
2. The first open needs a detour, because this app is not notarized by Apple:
   right-click the app, choose Open, then click Open in the dialog.
   Double-clicking works normally from then on.
3. If macOS says the app "is damaged and can't be opened", it was quarantined
   by the download. Clear it in Terminal, then open it again:
      xattr -dr com.apple.quarantine "/path/to/Lecture React.app"
4. Allow incoming connections when macOS asks. Students need to reach this Mac.
5. Connect students to the same network and share the QR code or join link.

Runs on both Apple Silicon and Intel Macs. The app declares macOS 10.13 as
its minimum, but only current macOS has been tested.
No Node, pnpm, Rust, or separate server install is required.

Settings live in your home folder, not inside the app, so copying the app to
another Mac starts it fresh. Live classes and questions are held in memory and
end when the app closes.
`);

const zip = join(REPO, 'dist', `${name}.zip`);
rmSync(zip, { force: true });
// ditto, not zip: it is the only archiver that keeps the bundle's symlinks and
// executable bits intact, and a mangled .app will not launch after unzipping.
run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', output, zip], join(REPO, 'dist'));
console.log(`macOS app: ${join(output, app)}\nArchive:   ${zip}`);
