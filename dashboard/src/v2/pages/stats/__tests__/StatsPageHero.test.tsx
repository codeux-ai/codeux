/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { StatsPageHero, getRelativeTime } from '../components/StatsPageHero.js';

describe('StatsPageHero', () => {
  describe('getRelativeTime', () => {
    it('returns "just now" for differences under 60 seconds', () => {
      const now = Date.now();
      expect(getRelativeTime(new Date(now).toISOString())).toBe('just now');
      expect(getRelativeTime(new Date(now - 59000).toISOString())).toBe('just now');
    });

    it('returns minutes for differences under an hour', () => {
      const now = Date.now();
      expect(getRelativeTime(new Date(now - 60000).toISOString())).toBe('1 min ago');
      expect(getRelativeTime(new Date(now - 3540000).toISOString())).toBe('59 min ago');
    });

    it('returns hours for differences under a day', () => {
      const now = Date.now();
      expect(getRelativeTime(new Date(now - 3600000).toISOString())).toBe('1 hr ago');
      expect(getRelativeTime(new Date(now - 82800000).toISOString())).toBe('23 hr ago');
    });

    it('returns days for differences of a day or more', () => {
      const now = Date.now();
      expect(getRelativeTime(new Date(now - 86400000).toISOString())).toBe('1 day ago');
      expect(getRelativeTime(new Date(now - 172800000).toISOString())).toBe('2 days ago');
    });

    it('returns empty string for invalid dates', () => {
      expect(getRelativeTime('invalid-date')).toBe('');
    });
  });

  it('renders the window chips above the view toggle', () => {
    const { container } = render(
      <StatsPageHero
        selectedProject={{ id: 'proj-1', name: 'Project 1' } as any}
        stats={{
          generatedAt: '2026-06-01T12:00:00Z',
          activeSprint: null,
          range: { resolutionLabel: 'Hourly', label: '24h' },
        } as any}
        activeQuery={{ window: 'custom' } as any}
        customFrom="2026-05-01"
        customTo="2026-05-02"
        applyPresetWindow={vi.fn()}
        setCustomFrom={vi.fn()}
        setCustomTo={vi.fn()}
        applyCustomRange={vi.fn()}
        visualMode="trend"
        setVisualMode={vi.fn()}
      />,
    );

    const presetButton = screen.getByRole('button', { name: '24h' });
    const trendButton = screen.getByRole('button', { name: 'Trend' });
    const ledgersButton = screen.getByRole('button', { name: 'Ledgers' });
    const systemButton = screen.getByRole('button', { name: 'System' });

    expect(presetButton.compareDocumentPosition(trendButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ledgersButton.compareDocumentPosition(systemButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll('input[type="date"]').length).toBe(2);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy();
  });
});
