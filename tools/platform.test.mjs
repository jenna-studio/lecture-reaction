import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { REPO, nodePlatform, pnpmCommand, unavailableAddress, packageCli } from './platform.mjs';
import { existsSync } from 'node:fs';

test('selects native Node distributions and Windows executable suffix', () => {
  assert.deepEqual(nodePlatform('win32', 'x64'), { os: 'win', arch: 'x64', extension: '.exe' });
  assert.deepEqual(nodePlatform('darwin', 'arm64'), { os: 'darwin', arch: 'arm64', extension: '' });
  assert.deepEqual(nodePlatform('linux', 'x64'), { os: 'linux', arch: 'x64', extension: '' });
  assert.throws(() => nodePlatform('linux', 'ia32'), /Unsupported/);
});

test('pnpm arguments and paths remain literal without a command shell', () => {
  const original = process.env.npm_execpath;
  try {
    process.env.npm_execpath = 'C:\\Users\\A B\\pnpm.cjs';
    const args = ['--config', JSON.stringify({ build: { devUrl: 'http://127.0.0.1:5175' } })];
    assert.deepEqual(pnpmCommand(args), [process.execPath, [process.env.npm_execpath, ...args]]);
  } finally {
    if (original === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = original;
  }
  assert.equal(REPO, fileURLToPath(new URL('../', import.meta.url)));
  assert.ok(existsSync(packageCli('esbuild', 'esbuild')));
  assert.ok(existsSync(packageCli('postject', 'postject')));
});

test('missing IPv6 does not mask occupied ports or IPv4 failures', () => {
  for (const code of ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT']) {
    assert.equal(unavailableAddress({ code }, '::1'), true);
    assert.equal(unavailableAddress({ code }, '127.0.0.1'), false);
  }
  assert.equal(unavailableAddress({ code: 'EADDRINUSE' }, '::1'), false);
  assert.equal(unavailableAddress({ code: 'EACCES' }, '::1'), false);
});
