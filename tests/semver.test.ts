import { describe, it, expect } from 'vitest';
import { isNewer } from '../src/main/semver';

describe('isNewer', () => {
  it('true khi latest cao hơn', () => {
    expect(isNewer('v0.3.0', '0.2.2')).toBe(true);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
  });
  it('false khi bằng hoặc thấp hơn', () => {
    expect(isNewer('0.2.2', '0.2.2')).toBe(false);
    expect(isNewer('v0.2.1', '0.2.2')).toBe(false);
  });
});
