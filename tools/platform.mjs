import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../', import.meta.url));

// Run JavaScript entrypoints directly: Windows .cmd shims cannot be spawned
// without a shell, and shell quoting breaks paths and JSON configuration.
export function pnpmCommand(args) {
  const cli = process.env.npm_execpath;
  if (!cli || !/pnpm\.(?:c?js|mjs)$/i.test(cli)) {
    throw new Error('Run this command through pnpm (for example, pnpm desktop).');
  }
  return [process.execPath, [cli, ...args]];
}

export function packageCli(name, bin) {
  const require = createRequire(new URL('../packages/server/package.json', import.meta.url));
  const manifestPath = require.resolve(`${name}/package.json`);
  const manifest = require(manifestPath);
  return resolve(dirname(manifestPath), manifest.bin[bin]);
}

export function nodePlatform(platform = process.platform, arch = process.arch) {
  if (!['darwin', 'linux', 'win32'].includes(platform) || !['x64', 'arm64'].includes(arch)) {
    throw new Error(`Unsupported server build platform: ${platform}/${arch}. Use x64 or arm64 on macOS, Windows, or Linux.`);
  }
  return { os: platform === 'win32' ? 'win' : platform, arch, extension: platform === 'win32' ? '.exe' : '' };
}

export function unavailableAddress(error, host) {
  return host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT'].includes(error.code);
}
