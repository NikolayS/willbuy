import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AddressInfo } from 'node:net';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(here, '..', 'fixtures');

export type FixtureServer = {
  url: (path: string) => string;
  port: number;
  close: () => Promise<void>;
};

/**
 * Tiny HTTP server that serves files from `test/fixtures` plus a few special
 * routes used by capture tests:
 *   GET /<name>.html       → the fixture file
 *   GET /__hang            → a never-completing keep-alive (for wall-clock test)
 *   GET /__ok              → 200 OK with empty body
 *   GET /__big-body?bytes= → response body of exactly N bytes (default 30 MB)
 *                            sets content-length so the total_bytes listener fires
 *
 * Bound on 127.0.0.1 with an OS-assigned port. Caller closes when done.
 */
export async function startFixtureServer(): Promise<FixtureServer> {
  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!req.url) {
        res.statusCode = 400;
        res.end();
        return;
      }
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/__hang') {
        // Deliberately never end the response; the wall-clock-breach test
        // relies on Playwright's networkidle never firing.
        res.setHeader('content-type', 'text/plain');
        res.write('hanging…');
        return;
      }
      if (url.pathname === '/__ok') {
        res.statusCode = 200;
        res.end('ok');
        return;
      }
      if (url.pathname === '/__big-body') {
        // Returns a response body of configurable size (default 30 MB) with
        // an explicit content-length header so the total_bytes listener can
        // tally it before the body is fully buffered. The body is repeated
        // ASCII so it never compresses down to nothing if gzip is applied.
        const bytes = parseInt(url.searchParams.get('bytes') ?? String(30 * 1024 * 1024), 10);
        const chunk = Buffer.alloc(65536, 'x');
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.setHeader('content-length', String(bytes));
        res.statusCode = 200;
        let written = 0;
        while (written < bytes) {
          const toWrite = Math.min(chunk.length, bytes - written);
          res.write(chunk.subarray(0, toWrite));
          written += toWrite;
        }
        res.end();
        return;
      }
      const safe = url.pathname.replace(/^\/+/, '');
      if (!/^[a-z0-9._-]+\.html$/i.test(safe)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const buf = await readFile(join(FIXTURE_DIR, safe));
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.statusCode = 200;
      res.end(buf);
    } catch {
      res.statusCode = 500;
      res.end();
    }
  });

  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    url: (path: string) => `http://127.0.0.1:${port}${path.startsWith('/') ? path : '/' + path}`,
    close: () =>
      new Promise<void>((ok, fail) => server.close((err) => (err ? fail(err) : ok()))),
  };
}
