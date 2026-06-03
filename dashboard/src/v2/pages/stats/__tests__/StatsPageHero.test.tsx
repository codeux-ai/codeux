/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { StatsPageHero } from '../components/StatsPageHero.js';

describe('StatsPageHero', () => {
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

    expect(presetButton.compareDocumentPosition(trendButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll('input[type="date"]').length).toBe(2);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy();
  });
});
