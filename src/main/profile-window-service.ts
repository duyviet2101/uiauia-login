import type { BrowserContext } from 'playwright-core';
import type { Profile } from './types';

export interface ProfileWindowService {
  attach(profile: Profile, context: BrowserContext): Promise<void>;
  refresh(profile: Profile): Promise<void>;
  detach(profileId: string): void;
  dispose(): void;
}

export class NullProfileWindowService implements ProfileWindowService {
  async attach(_profile: Profile, _context: BrowserContext): Promise<void> {}
  async refresh(_profile: Profile): Promise<void> {}
  detach(_profileId: string): void {}
  dispose(): void {}
}
