// Minimal static file server for the task pages (web/).
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB_ROOT = fileURLToPath(new URL('../web/', import.meta.url));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export interface TaskServer {
  url: string;
  close(): Promise<void>;
}

/**
 * Send the file at `path` (a URL path) from under `root`. Returns false if there is
 * no such file. Paths that would escape `root` are refused.
 */
export async function sendFile(res: ServerResponse, root: string, path: string): Promise<boolean> {
  const base = root.endsWith(sep) ? root : root + sep;
  const file = normalize(join(base, path.endsWith('/') ? `${path}index.html` : path));
  if (!file.startsWith(base)) {
    res.writeHead(403).end('forbidden');
    return true;
  }
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch {
    return false;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
  return true;
}

/** Serve only the task pages. The browser that runs the tasks loads them from here. */
export async function startServer(port = 0, host = '127.0.0.1'): Promise<TaskServer> {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      if (!(await sendFile(res, WEB_ROOT, path))) res.writeHead(404).end('not found');
    } catch {
      if (!res.headersSent) res.writeHead(400);
      res.end('bad request');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const addr = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
