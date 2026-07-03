import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/preact';
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

  it('exposes grouped pressed-state controls for presets and analysis modes', () => {
    render(
      <StatsPageHero
        selectedProject={{ id: 'proj-1', name: 'Project 1' } as any}
        stats={null}
        activeQuery={{ window: '24h' } as any}
        customFrom="2026-05-01"
        customTo="2026-05-02"
        applyPresetWindow={vi.fn()}
        setCustomFrom={vi.fn()}
        setCustomTo={vi.fn()}
        applyCustomRange={vi.fn()}
        visualMode="models"
        setVisualMode={vi.fn()}
      />,
    );

    expect(screen.getByRole('group', { name: 'Time window presets' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'false');

    expect(screen.getByRole('group', { name: 'Analytics modes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Models' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Trend' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Executive summary')).toBeTruthy();
  });

  it('disables the Apply button when custom dates are missing', () => {
    cleanup();
    const { rerender } = render(
      <StatsPageHero
        selectedProject={{ id: 'proj-1', name: 'Project 1' } as any}
        stats={null}
        activeQuery={{ window: 'custom' } as any}
        customFrom={""}
        customTo={""}
        applyPresetWindow={vi.fn()}
        setCustomFrom={vi.fn()}
        setCustomTo={vi.fn()}
        applyCustomRange={vi.fn()}
        visualMode="trend"
        setVisualMode={vi.fn()}
      />
    );

    let applyBtn = screen.getAllByRole('button', { name: 'Apply' })[0] as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);

    rerender(
      <StatsPageHero
        selectedProject={{ id: 'proj-1', name: 'Project 1' } as any}
        stats={null}
        activeQuery={{ window: 'custom' } as any}
        customFrom="2026-05-01"
        customTo="2026-05-02"
        applyPresetWindow={vi.fn()}
        setCustomFrom={vi.fn()}
        setCustomTo={vi.fn()}
        applyCustomRange={vi.fn()}
        visualMode="trend"
        setVisualMode={vi.fn()}
      />
    );

    applyBtn = screen.getAllByRole('button', { name: 'Apply' })[0] as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(false);
  });

  it('reveals custom dates from the Custom preset without applying the range', () => {
    cleanup();
    const applyCustomRange = vi.fn();
    const applyCustomWindow = vi.fn();

    render(
      <StatsPageHero
        selectedProject={{ id: 'proj-1', name: 'Project 1' } as any}
        stats={null}
        activeQuery={{ window: '24h' } as any}
        customFrom="2026-05-01"
        customTo="2026-05-02"
        applyPresetWindow={vi.fn()}
        applyCustomWindow={applyCustomWindow}
        setCustomFrom={vi.fn()}
        setCustomTo={vi.fn()}
        applyCustomRange={applyCustomRange}
        visualMode="trend"
        setVisualMode={vi.fn()}
      />
    );

    expect(screen.queryByLabelText('Custom start date')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));

    expect(screen.getByLabelText('Custom start date')).toBeTruthy();
    expect(screen.getByLabelText('Custom end date')).toBeTruthy();
    expect(applyCustomWindow).not.toHaveBeenCalled();
    expect(applyCustomRange).not.toHaveBeenCalled();
  });

  it('blocks and announces custom ranges where the end date is before the start date', () => {
    cleanup();

    render(
      <StatsPageHero
        selectedProject={{ id: 'proj-1', name: 'Project 1' } as any}
        stats={null}
        activeQuery={{ window: 'custom' } as any}
        customFrom="2026-05-03"
        customTo="2026-05-02"
        applyPresetWindow={vi.fn()}
        setCustomFrom={vi.fn()}
        setCustomTo={vi.fn()}
        applyCustomRange={vi.fn()}
        visualMode="trend"
        setVisualMode={vi.fn()}
      />
    );

    const applyBtn = screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent('End date must be after start date.');
    expect(screen.getByLabelText('Custom start date')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Custom end date')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Custom start date')).toHaveAttribute('aria-errormessage', 'stats-custom-range-error');
    expect(screen.getByLabelText('Custom end date')).toHaveAttribute('aria-errormessage', 'stats-custom-range-error');
  });
});
