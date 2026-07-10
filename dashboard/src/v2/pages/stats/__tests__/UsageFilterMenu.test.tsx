/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import gsap from 'gsap';
import { groupChartSeries } from '../chart-view-models.js';

vi.mock('gsap', () => ({
  default: {
    matchMedia: vi.fn().mockReturnValue({
      add: vi.fn().mockImplementation((_q, cb) => { if (_q.includes('no-preference')) cb(); }),
      revert: vi.fn()
    }),
    fromTo: vi.fn(),
    to: vi.fn(),
    set: vi.fn(),
    getProperty: vi.fn()
  }
}));
import { UsageFilterMenu } from '../components/UsageFilterMenu.js';

describe('UsageFilterMenu', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const mockProps = {
    isOpen: true,
    onClose: vi.fn(),
    stats: {
      chartSeries: [
        { id: 'tokens', label: 'Tokens', color: '#00E0A0', defaultEnabled: true },
        { id: 'active', label: 'Active Time', color: '#FFB800', defaultEnabled: true }
      ]
    } as any,
    enabledSeries: { tokens: true, active: true },
    setEnabledSeries: vi.fn(),
    resetEnabledSeries: vi.fn(),
    activeSeriesCount: 2,
    seriesGroups: groupChartSeries([
      { id: 'tokens', label: 'Tokens', grouping: 'Usage', color: '#00E0A0', defaultEnabled: true, data: [] },
      { id: 'active', label: 'Active Time', grouping: 'Usage', color: '#FFB800', defaultEnabled: true, data: [] }
    ], { tokens: true, active: true })
  };

  it('should render when open', () => {
    const { getByRole, getByText } = render(<UsageFilterMenu {...mockProps} />);
    expect(getByRole('dialog', { name: 'Graph Filters' })).toBeTruthy();
    expect(getByText('Graph Filters')).toBeTruthy();
    expect(getByText('Showing 2 filters')).toBeTruthy();
    expect(getByText('Metric Series')).toBeTruthy();
    expect(getByText('2 of 2 series active')).toBeTruthy();
    expect(getByText('2/2 active')).toBeTruthy();
  });

  it('should call onClose when close button is clicked', () => {
    const { getAllByRole } = render(<UsageFilterMenu {...mockProps} />);
    const closeButton = getAllByRole('button').find(b => b.getAttribute('aria-label') === 'Close graph filters')!;
    fireEvent.click(closeButton);
    expect(mockProps.onClose).toHaveBeenCalled();
  });

  it('should call setEnabledSeries when a metric button is clicked', () => {
    const { getByRole } = render(<UsageFilterMenu {...mockProps} />);
    const metricButton = getByRole('switch', { name: /Tokens Metric series, enabled/i });
    expect(metricButton.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(metricButton);
    expect(mockProps.setEnabledSeries).toHaveBeenCalled();
  });

  it('should reset filters to default enabled series and preserve one active series', () => {
    const setEnabledSeriesSpy = vi.fn();
    const props = {
      ...mockProps,
      stats: {
        chartSeries: [
          { id: 'tokens', label: 'Tokens', color: '#00E0A0', defaultEnabled: false },
          { id: 'active', label: 'Active Time', color: '#FFB800', defaultEnabled: false }
        ]
      } as any,
      setEnabledSeries: setEnabledSeriesSpy,
      resetEnabledSeries: setEnabledSeriesSpy,
      activeSeriesCount: 2,
      seriesGroups: groupChartSeries([
        { id: 'tokens', label: 'Tokens', grouping: 'Usage', color: '#00E0A0', defaultEnabled: false, data: [] },
        { id: 'active', label: 'Active Time', grouping: 'Usage', color: '#FFB800', defaultEnabled: false, data: [] }
      ], { tokens: false, active: false }),
    };

    const { getByRole } = render(<UsageFilterMenu {...props} />);
    fireEvent.click(getByRole('button', { name: 'Reset filters' }));

    expect(setEnabledSeriesSpy).toHaveBeenCalled();
  });

  it('enables all default series without disabling existing custom selections', () => {
    const setEnabledSeriesSpy = vi.fn();
    const props = {
      ...mockProps,
      enabledSeries: { tokens: false, active: true },
      setEnabledSeries: setEnabledSeriesSpy,
      activeSeriesCount: 1,
      seriesGroups: groupChartSeries([
        { id: 'tokens', label: 'Tokens', grouping: 'Usage', color: '#00E0A0', defaultEnabled: true, data: [] },
        { id: 'active', label: 'Active Time', grouping: 'Usage', color: '#FFB800', defaultEnabled: false, data: [] }
      ], { tokens: false, active: true })
    };

    render(<UsageFilterMenu {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable defaults' }));

    expect(setEnabledSeriesSpy).toHaveBeenCalled();
    const updater = setEnabledSeriesSpy.mock.calls[0]?.[0] as (curr: Record<string, boolean>) => Record<string, boolean>;
    expect(updater({ tokens: false, active: true })).toEqual({ tokens: true, active: true });
  });

  it('should not allow disabling the last enabled series', () => {
    const setEnabledSeriesSpy = vi.fn();
    const singleSeriesProps = {
      ...mockProps,
      enabledSeries: { tokens: true, active: false },
      setEnabledSeries: setEnabledSeriesSpy,
      activeSeriesCount: 1,
      seriesGroups: groupChartSeries(mockProps.stats.chartSeries, { tokens: true, active: false })
    };
    const { getByRole, getByText } = render(<UsageFilterMenu {...singleSeriesProps} />);
    setEnabledSeriesSpy.mockClear();

    // Check live region
    expect(getByText('Showing 1 filter')).toBeTruthy();

    const tokensButton = getByRole('switch', { name: /tokens/i });
    expect(tokensButton.getAttribute('aria-disabled')).toBe('true');
    expect(tokensButton.getAttribute('aria-checked')).toBe('true');
    const describedBy = tokensButton.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toContain('Keep one series enabled so the chart can still render.');
    fireEvent.click(tokensButton);
    expect(setEnabledSeriesSpy).not.toHaveBeenCalled();
  });

  it('focuses the first useful switch and restores trigger focus on Escape', () => {
    const onStatusChange = vi.fn();

    const Wrapper = () => {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>Open filters</button>
          <UsageFilterMenu
            {...mockProps}
            isOpen={open}
            onClose={() => setOpen(false)}
            onStatusChange={onStatusChange}
          />
        </div>
      );
    };

    render(<Wrapper />);
    const trigger = screen.getByRole('button', { name: 'Open filters' });
    trigger.focus();
    fireEvent.click(trigger);

    expect((document.activeElement as HTMLElement).getAttribute('role')).toBe('switch');

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(document.activeElement).toBe(trigger);
  });

  it('restores trigger focus when the explicit close control is used', () => {
    const Wrapper = () => {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>Open filters</button>
          <UsageFilterMenu {...mockProps} isOpen={open} onClose={() => setOpen(false)} />
        </div>
      );
    };

    render(<Wrapper />);
    const trigger = screen.getByRole('button', { name: 'Open filters' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Close graph filters' }));

    expect(document.activeElement).toBe(trigger);
  });

  it('keeps long series labels wrapped inside the flyout', () => {
    const longLabel = 'Extremely long provider and model telemetry label that must stay within the available filter width';
    render(<UsageFilterMenu
      {...mockProps}
      stats={{ chartSeries: [{ id: 'long', label: longLabel }] } as any}
      enabledSeries={{ long: true }}
      activeSeriesCount={1}
      seriesGroups={groupChartSeries([
        { id: 'long', label: longLabel, grouping: 'Providers', color: '#00E0A0', defaultEnabled: true, data: [] },
      ], { long: true })}
    />);

    const label = screen.getByText(longLabel);
    expect(label.classList.contains('break-words')).toBe(true);
    expect(label.closest('button')?.classList.contains('max-w-full')).toBe(true);
  });

  it('uses static flyout geometry for reduced motion', () => {
    vi.mocked(gsap.matchMedia).mockReturnValueOnce({
      add: vi.fn().mockImplementation((query, callback) => {
        if (query.includes('reduce')) callback();
      }),
      revert: vi.fn(),
    } as any);

    render(<UsageFilterMenu {...mockProps} />);

    expect(gsap.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ opacity: 1, scale: 1, y: 0 }));
  });

  it('announces filter reset feedback', () => {
    const onStatusChange = vi.fn();
    render(<UsageFilterMenu {...mockProps} onStatusChange={onStatusChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));

    expect(onStatusChange).toHaveBeenCalledWith('Graph filters reset. 2 series active.');
  });

  it('announces last-series guard feedback from aria-disabled switches', () => {
    const onStatusChange = vi.fn();
    const setEnabledSeriesSpy = vi.fn();
    const singleSeriesProps = {
      ...mockProps,
      enabledSeries: { tokens: true, active: false },
      setEnabledSeries: setEnabledSeriesSpy,
      activeSeriesCount: 1,
      seriesGroups: groupChartSeries(mockProps.stats.chartSeries, { tokens: true, active: false }),
      onStatusChange,
    };

    render(<UsageFilterMenu {...singleSeriesProps} />);
    fireEvent.click(screen.getByRole('switch', { name: /Tokens/i }));

    expect(setEnabledSeriesSpy).not.toHaveBeenCalled();
    expect(onStatusChange).toHaveBeenCalledWith('Keep at least one series enabled. The last active series cannot be turned off.');
  });
});
