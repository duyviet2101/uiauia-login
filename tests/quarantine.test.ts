import { describe, it, expect, vi } from 'vitest';
import { clearQuarantine } from '../src/main/quarantine';

describe('clearQuarantine', () => {
  it('runs xattr -cr on darwin', async () => {
    const exec = vi.fn((_cmd: string, _args: string[], cb: (e: Error | null) => void) => cb(null));
    await clearQuarantine('/path/Chromium.app', 'darwin', exec as any);
    expect(exec).toHaveBeenCalledWith('xattr', ['-cr', '/path/Chromium.app'], expect.any(Function));
  });

  it('no-op on non-darwin', async () => {
    const exec = vi.fn();
    await clearQuarantine('/path', 'win32', exec as any);
    expect(exec).not.toHaveBeenCalled();
  });
});
