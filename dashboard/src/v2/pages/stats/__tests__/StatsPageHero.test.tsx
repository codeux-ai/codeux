import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);
/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/preact';
import { StatsPageHero, getRelativeTime } from '../components/StatsPageHero.js';
import { StatsI18nProvider } from '../stats-i18n.js';

function createStats(overrides: Record<string, unknown> = {}) {
  const usage = {
    invocationCount: 12,
    activeTimeMs: 125000,
    wallTimeMs: 180000,
    inputTokens: 1000,
    cachedInputTokens: 250,
    outputTokens: 750,
    reasoningOutputTokens: 100,
    totalTokens: 2100,
    inputCostUsd: 0,
    outputCostUsd: 0,
    cachedInputCostUsd: 0,
    totalCostUsd: 0,
    reportedInvocationCount: 10,
    estimatedInvocationCount: 2,
    unavailableInvocationCount: 0,
    unsupportedInvocationCount: 0,
  };

  return {
    projectId: 'proj-1',
    projectName: 'Project 1',
    window: '24h',
    query: { window: '24h' },
    generatedAt: '2026-06-01T12:00:00Z',
    activeSprint: null,
    range: {
      window: '24h',
      resolution: 'hour',
      resolutionLabel: 'Hourly',
      label: '24h',
      from: '2026-06-01T00:00:00Z',
      to: '2026-06-02T00:00:00Z',
      bucketCount: 24,
      isCustom: false,
    },
    usage,
    git: {
      totals: { insertions: 0, deletions: 0, filesChanged: 0, prCount: 0, mergedCount: 0, mergeConflictCount: 0 },
      buckets: [],
      tasks: [],
      sprints: [],
    },
    buckets: [],
    sprints: [],
    tasks: [],
    providers: [{ id: 'codex', label: 'Codex', secondaryLabel: null, status: null, purpose: null, provider: 'codex', usage, lastActivityAt: null }],
    purposes: [],
    models: [{
      id: 'codex:gpt-5',
      provider: 'codex',
      model: 'gpt-5',
      label: 'GPT-5',
      usage,
      statusCounts: { completed: 9, failed: 1, cancelled: 0, running: 1, paused: 0 },
      successRate: 0.9,
      duration: { sampleCount: 10, avgMs: 1000, p50Ms: 900, p95Ms: 2000, maxMs: 2400 },
      lastActivityAt: '2026-06-01T12:00:00Z',
    }],
    statusCounts: { completed: 9, failed: 1, cancelled: 0, running: 1, paused: 0 },
    duration: { sampleCount: 10, avgMs: 1000, p50Ms: 900, p95Ms: 2000, maxMs: 2400 },
    tokenSources: [],
    chartSeries: [],
    ...overrides,
  } as any;
}

describe('StatsPageHero', () => {
  afterEach(() => {
    cleanup();
  });
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
        stats={createStats()}
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
    expect(screen.getByText('Token, invocation, and runtime movement across the selected range.')).toBeTruthy();
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

    expect(screen.getByRole('heading', { name: 'Stats' })).toBeTruthy();
    expect(screen.getByLabelText('Stats active lens')).toHaveTextContent('Window');
    expect(screen.getByLabelText('Stats active lens')).toHaveTextContent('24h');
    expect(screen.getByLabelText('Stats active lens')).toHaveTextContent('Mode');
    expect(screen.getByLabelText('Stats active lens')).toHaveTextContent('Models');
    expect(screen.getByLabelText('Stats project context')).toHaveTextContent('Project');
    expect(screen.getByLabelText('Stats project context')).toHaveTextContent('Project 1');
    expect(screen.getByLabelText('Stats project context')).toHaveTextContent('Generated');
    expect(screen.getByLabelText('Stats project context')).toHaveTextContent('No snapshot');
    expect(screen.getByRole('group', { name: 'Time window presets' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'false');

    expect(screen.getByRole('group', { name: 'Analytics modes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Models' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Models' })).toHaveAttribute('aria-controls', 'stats-analysis-panel');
    expect(screen.getByRole('button', { name: 'Trend' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Model activity, latency, cache behavior, and reliability signals.')).toBeTruthy();
    expect(screen.queryByLabelText('Executive summary')).toBeNull();
  });

  it('supports arrow-key navigation across analysis modes', () => {
    const setVisualMode = vi.fn();

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
        visualMode="trend"
        setVisualMode={setVisualMode}
      />,
    );

    const modeGroup = screen.getByRole('group', { name: 'Analytics modes' });
    const trendButton = screen.getByRole('button', { name: 'Trend' });
    const compositionButton = screen.getByRole('button', { name: 'Composition' });
    trendButton.focus();

    fireEvent.keyDown(modeGroup, { key: 'ArrowRight' });

    expect(setVisualMode).toHaveBeenCalledWith('composition');
    expect(compositionButton).toHaveFocus();
  });

  it('invokes preset and visual-mode callbacks from the command controls', () => {
    const applyPresetWindow = vi.fn();
    const setVisualMode = vi.fn();

    render(
      <StatsPageHero
        selectedProject={{ id: 'proj-1', name: 'Project 1' } as any}
        stats={createStats()}
        activeQuery={{ window: '24h' } as any}
        customFrom="2026-05-01"
        customTo="2026-05-02"
        applyPresetWindow={applyPresetWindow}
        setCustomFrom={vi.fn()}
        setCustomTo={vi.fn()}
        applyCustomRange={vi.fn()}
        visualMode="trend"
        setVisualMode={setVisualMode}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '7d' }));
    expect(applyPresetWindow).toHaveBeenCalledWith('7d');

    fireEvent.click(screen.getByRole('button', { name: 'Providers' }));
    expect(setVisualMode).toHaveBeenCalledWith('reliability');

    fireEvent.click(screen.getByRole('button', { name: 'System' }));
    expect(setVisualMode).toHaveBeenCalledWith('system');
  });

  it('renders compact context details from usage, models, sprint, and range', () => {
    render(
      <StatsPageHero
        selectedProject={{ id: 'proj-1', name: 'Project 1' } as any}
        stats={createStats({
          activeSprint: { sprintId: 'sprint-1', sprintName: 'Launch', sprintNumber: 4 },
          range: {
            window: 'custom',
            resolution: 'day',
            resolutionLabel: 'Daily',
            label: 'May 1 → May 7',
            from: '2026-05-01T00:00:00Z',
            to: '2026-05-07T00:00:00Z',
            bucketCount: 7,
            isCustom: true,
          },
        })}
        activeQuery={{ window: 'custom', from: '2026-05-01', to: '2026-05-07' } as any}
        customFrom="2026-05-01"
        customTo="2026-05-07"
        applyPresetWindow={vi.fn()}
        setCustomFrom={vi.fn()}
        setCustomTo={vi.fn()}
        applyCustomRange={vi.fn()}
        visualMode="reliability"
        setVisualMode={vi.fn()}
      />,
    );

    expect(screen.getByText('#4')).toBeTruthy();
    expect(screen.getByLabelText('Stats project context')).toHaveTextContent('Generated');
    expect(screen.queryByText('Daily · 7 buckets')).toBeNull();
    expect(screen.queryByText('Mixed')).toBeNull();
    expect(screen.queryByText('1 / 1 providers')).toBeNull();
    expect(screen.queryByLabelText('Executive summary')).toBeNull();
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
    expect(applyBtn.disabled).toBe(false);
    expect(applyBtn).toHaveAttribute('aria-disabled', 'true');

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
    expect(applyBtn).not.toHaveAttribute('aria-disabled');
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
    expect(screen.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-expanded', 'true');
    expect(applyCustomWindow).not.toHaveBeenCalled();
    expect(applyCustomRange).not.toHaveBeenCalled();
  });

  it('applies a valid custom range only from the Apply action', () => {
    cleanup();
    const applyPresetWindow = vi.fn();
    const applyCustomRange = vi.fn();

    render(
      <StatsPageHero
        selectedProject={{ id: 'proj-1', name: 'Project 1' } as any}
        stats={null}
        activeQuery={{ window: '24h' } as any}
        customFrom="2026-05-01"
        customTo="2026-05-02"
        applyPresetWindow={applyPresetWindow}
        setCustomFrom={vi.fn()}
        setCustomTo={vi.fn()}
        applyCustomRange={applyCustomRange}
        visualMode="trend"
        setVisualMode={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    expect(applyPresetWindow).not.toHaveBeenCalled();
    expect(applyCustomRange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(applyCustomRange).toHaveBeenCalledTimes(1);
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
    expect(applyBtn.disabled).toBe(false);
    expect(applyBtn).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('End date must be after start date.');
    expect(screen.getByLabelText('Custom start date')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByLabelText('Custom end date')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Custom start date')).not.toHaveAttribute('aria-errormessage');
    expect(screen.getByLabelText('Custom end date')).toHaveAttribute('aria-errormessage', 'stats-custom-range-error');
    expect(screen.getByLabelText('Custom start date')).toHaveAttribute('aria-describedby', expect.stringContaining('stats-custom-range-error'));
    expect(screen.getByLabelText('Custom end date')).toHaveAttribute('aria-describedby', expect.stringContaining('stats-custom-range-error'));
  });

  it('does not render clipping-prone horizontal overflow wrappers in the command controls', () => {
    const { container } = render(
      <StatsPageHero
        selectedProject={{ id: 'proj-1', name: 'Project 1' } as any}
        stats={createStats()}
        activeQuery={{ window: '24h' } as any}
        customFrom="2026-05-01"
        customTo="2026-05-02"
        applyPresetWindow={vi.fn()}
        setCustomFrom={vi.fn()}
        setCustomTo={vi.fn()}
        applyCustomRange={vi.fn()}
        visualMode="system"
        setVisualMode={vi.fn()}
      />,
    );

    expect(container.querySelector('.overflow-x-auto')).toBeNull();
    expect(container.querySelector('.min-w-max')).toBeNull();
    expect(container.querySelector('.\\!flex-nowrap')).toBeNull();
    expect(screen.getByRole('group', { name: 'Time window presets' }).className).toContain('flex-wrap');
    expect(screen.getByRole('group', { name: 'Analytics modes' }).className).toContain('flex-wrap');
  });

  it('renders German presets, locale labels, and invalid custom-range feedback', () => {
    render(
      <StatsI18nProvider locale="de">
        <StatsPageHero
          selectedProject={{ id: 'proj-1', name: 'Project 1' } as any}
          stats={createStats()}
          activeQuery={{ window: 'custom' } as any}
          customFrom="2026-07-10"
          customTo="2026-07-01"
          applyPresetWindow={vi.fn()}
          setCustomFrom={vi.fn()}
          setCustomTo={vi.fn()}
          applyCustomRange={vi.fn()}
          visualMode="composition"
          setVisualMode={vi.fn()}
        />
      </StatsI18nProvider>,
    );

    expect(screen.getByRole('group', { name: 'Zeitraumvorgaben' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Gesamter Zeitraum' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Benutzerdefiniert' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Statistik-Analysemodi' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zeitraum anwenden' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Das Enddatum muss nach dem Startdatum liegen.');
    expect(getRelativeTime(new Date(Date.now() - 120_000).toISOString(), 'de')).toBe('vor 2 Min.');
  });
});
