import { describe, it, expect, beforeEach } from 'vitest';
/** @vitest-environment jsdom */
import { applyAppearanceSettings } from '../apply-appearance.js';

describe('applyAppearanceSettings', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    document.documentElement.style.background = '';
    document.body.style.background = '';
    delete document.documentElement.dataset.reducedMotion;
  });

  it('applies DARK theme correctly', () => {
    applyAppearanceSettings({ theme: 'DARK' });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.background).toBe('rgb(13, 15, 18)');
    expect(document.body.style.background).toBe('rgb(13, 15, 18)');
  });

  it('applies LIGHT theme correctly', () => {
    applyAppearanceSettings({ theme: 'LIGHT' });
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.background).toBe('rgb(219, 232, 248)');
    expect(document.body.style.background).toBe('rgb(219, 232, 248)');
  });

  it('applies reducedMotion correctly', () => {
    applyAppearanceSettings({ reducedMotion: 'REDUCE' });
    expect(document.documentElement.dataset.reducedMotion).toBe('REDUCE');
  });
});
