import { describe, it, expect } from 'vitest';
import { parseProxyString } from '../src/main/proxy-parse';

describe('parseProxyString', () => {
  it('host:port:user:pass', () => {
    expect(parseProxyString('145.223.61.148:8180:username:password')).toEqual({
      type: undefined, host: '145.223.61.148', port: 8180, username: 'username', password: 'password',
    });
  });

  it('host:port only', () => {
    expect(parseProxyString('1.2.3.4:1080')).toEqual({
      type: undefined, host: '1.2.3.4', port: 1080, username: undefined, password: undefined,
    });
  });

  it('user:pass@host:port', () => {
    expect(parseProxyString('user:pass@1.2.3.4:8080')).toEqual({
      type: undefined, host: '1.2.3.4', port: 8080, username: 'user', password: 'pass',
    });
  });

  it('scheme://user:pass@host:port detects socks5', () => {
    expect(parseProxyString('socks5://u:p@9.9.9.9:1080')).toEqual({
      type: 'socks5', host: '9.9.9.9', port: 1080, username: 'u', password: 'p',
    });
  });

  it('http scheme detected', () => {
    expect(parseProxyString('http://1.2.3.4:3128')?.type).toBe('http');
  });

  it('password containing colons is preserved', () => {
    expect(parseProxyString('h:80:user:pa:ss:word')?.password).toBe('pa:ss:word');
  });

  it('trims whitespace', () => {
    expect(parseProxyString('  1.2.3.4:8080  ')?.host).toBe('1.2.3.4');
  });

  it('returns null for invalid input', () => {
    expect(parseProxyString('')).toBeNull();
    expect(parseProxyString('not-a-proxy')).toBeNull();
    expect(parseProxyString('1.2.3.4:notaport')).toBeNull();
    expect(parseProxyString('1.2.3.4:99999')).toBeNull();
  });
});
