import type { ProxyConfig } from './types';

export type ParsedProxy = {
  type?: ProxyConfig['type'];
  host: string;
  port: number;
  username?: string;
  password?: string;
};

/**
 * Parse a pasted proxy string into its parts. Accepts the common formats:
 *   host:port
 *   host:port:user:pass
 *   user:pass@host:port
 *   scheme://host:port  /  scheme://user:pass@host:port   (http/https/socks)
 * Returns null when host or port can't be determined.
 */
export function parseProxyString(raw: string): ParsedProxy | null {
  let s = raw.trim();
  if (!s) return null;

  let type: ProxyConfig['type'] | undefined;
  const scheme = s.match(/^(socks5h?|socks4?|https?):\/\//i);
  if (scheme) {
    type = scheme[1].toLowerCase().startsWith('socks') ? 'socks5' : 'http';
    s = s.slice(scheme[0].length);
  }

  let username: string | undefined;
  let password: string | undefined;

  // user:pass@host:port  (host never contains '@', so split on the last one)
  const at = s.lastIndexOf('@');
  let hostport = s;
  if (at !== -1) {
    const creds = s.slice(0, at);
    hostport = s.slice(at + 1);
    const ci = creds.indexOf(':');
    if (ci !== -1) {
      username = creds.slice(0, ci);
      password = creds.slice(ci + 1);
    } else {
      username = creds;
    }
  }

  const parts = hostport.split(':');
  if (parts.length < 2) return null;

  const host = parts[0].trim();
  const port = Number(parts[1].trim());
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;

  // Colon-delimited credentials: host:port:user:pass
  if (at === -1 && parts.length >= 3) {
    username = parts[2];
    password = parts.slice(3).join(':') || undefined;
  }

  return {
    type,
    host,
    port,
    username: username || undefined,
    password: password || undefined,
  };
}
