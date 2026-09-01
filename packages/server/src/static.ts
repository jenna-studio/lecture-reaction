/**
 * Minimal static file server for the built student app.
 *
 * Deliberately dependency-free: the only thing we serve is a Vite `dist`
 * folder, so a path-safety check, a content-type table and an SPA fallback
 * are all that is required. A missing `dist` is never fatal.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export class StaticSite {
  constructor(private readonly root: string) {}

  get available(): boolean {
    return existsSync(join(this.root, 'index.html'));
  }

  /** Serves `pathname`, falling back to index.html so client routing works. */
  serve(req: IncomingMessage, res: ServerResponse, pathname: string): void {
    if (!this.available) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(
        'Lecture React server is running, but the student app has not been built yet.\n' +
          'Run `pnpm -F @lr/student build` (or `pnpm dev` for the Vite dev server).\n',
      );
      return;
    }

    const file = this.resolveFile(pathname);
    if (!file) {
      // SPA fallback: unknown paths render the app shell.
      this.sendFile(req, res, join(this.root, 'index.html'));
      return;
    }
    this.sendFile(req, res, file);
  }

  /** Maps a URL path to a real file inside root, or null if there isn't one. */
  private resolveFile(pathname: string): string | null {
    const decoded = safeDecode(pathname);
    if (decoded === null) return null;

    const candidate = resolve(this.root, '.' + normalize(decoded));
    // Path traversal guard: never escape the dist directory.
    if (candidate !== this.root && !candidate.startsWith(this.root + sep)) return null;

    try {
      const stat = statSync(candidate);
      if (stat.isDirectory()) {
        const index = join(candidate, 'index.html');
        return existsSync(index) ? index : null;
      }
      return stat.isFile() ? candidate : null;
    } catch {
      return null;
    }
  }

  private sendFile(req: IncomingMessage, res: ServerResponse, file: string): void {
    const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    // Hashed Vite assets may be cached hard; the shell must not be.
    const immutable = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      'content-type': type,
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = createReadStream(file);
    stream.on('error', () => {
      res.end();
    });
    stream.pipe(res);
  }
}

function safeDecode(pathname: string): string | null {
  try {
    const decoded = decodeURIComponent(pathname);
    return decoded.includes('\0') ? null : decoded;
  } catch {
    return null;
  }
}
