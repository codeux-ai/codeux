import { BACKGROUND_PATTERNS } from './background-patterns.js';

export function applyAppearanceSettings(appearance: Partial<import('../../types.js').DashboardSettings['appearance']>): void {
  if (typeof window === 'undefined') return;

  if (appearance.theme !== undefined) {
    let isDark = false;
    if (appearance.theme === 'SYSTEM') {
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } else {
      isDark = appearance.theme === 'DARK';
    }

    const bg = isDark ? '#0d0f12' : '#dbe8f8';

    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    document.documentElement.style.background = bg;
    document.body.style.background = bg;
  }

  if (appearance.reducedMotion !== undefined) {
    document.documentElement.dataset.reducedMotion = appearance.reducedMotion;
  }

  if (appearance.backgroundPattern !== undefined) {
    const pattern = appearance.backgroundPattern;
    const patternUrl = pattern && pattern !== 'NONE' ? BACKGROUND_PATTERNS[pattern] : '';
    document.documentElement.style.setProperty('--bg-pattern', patternUrl);

    if (pattern && pattern !== 'NONE') {
      document.documentElement.classList.add('has-bg-pattern');
    } else {
      document.documentElement.classList.remove('has-bg-pattern');
    }
  }

  if (appearance.backgroundImage !== undefined) {
    if (appearance.backgroundImage) {
      document.documentElement.style.setProperty('--bg-image', `url(${appearance.backgroundImage})`);
      document.documentElement.classList.add('has-bg-image');
    } else {
      document.documentElement.style.removeProperty('--bg-image');
      document.documentElement.classList.remove('has-bg-image');
    }
  }

  if (appearance.zoomLevel !== undefined && appearance.zoomLevel !== null) {
    // Electron-only: native Chromium zoom recalculates the viewport so the
    // sidebar/dock and other fixed elements stay reachable. In a regular
    // browser we deliberately do nothing — CSS `zoom` breaks layouts and
    // users have the browser's own Ctrl +/- if they want to scale.
    const desktop = window.codeUxDesktop;
    if (desktop?.setZoom) {
      const clamped = Math.min(2, Math.max(0.5, appearance.zoomLevel));
      void desktop.setZoom(clamped);
    }
    document.documentElement.style.removeProperty('zoom');
  }
}
