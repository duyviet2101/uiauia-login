import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';

const PROBE_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<title>verify-windows probe</title></head>' +
  '<body><main>fingerprint probe surface</main></body></html>';

export interface ProbeServer {
  /** A loopback URL; Chromium treats 127.0.0.1 as a SECURE context, so the
   *  probe page exposes secure-context-only APIs (navigator.deviceMemory,
   *  navigator.userAgentData) while staying fully offline — no external CDN. */
  url: string;
  close: () => Promise<void>;
}

/**
 * Start a throwaway loopback HTTP server that serves one minimal HTML page.
 * Navigating the probe page here (instead of about:blank, which is not a secure
 * context in CloakBrowser) is what makes UA-Client-Hints and Device Memory
 * measurable, without loading any third-party resource.
 */
export async function startProbeServer(): Promise<ProbeServer> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PROBE_HTML);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
