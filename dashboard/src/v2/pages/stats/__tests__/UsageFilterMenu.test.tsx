/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import gsap from 'gsap';

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
    setEnabledSeries: vi.fn()
  };

  it('should render when open', () => {
    const { getByText } = render(<UsageFilterMenu {...mockProps} />);
    expect(getByText('Graph Filters')).toBeTruthy();
    expect(getByText('Metric Series')).toBeTruthy();
  });

  it('should call onClose when close button is clicked', () => {
    const { getAllByRole } = render(<UsageFilterMenu {...mockProps} />);
    const closeButton = getAllByRole('button').find(b => b.getAttribute('aria-label') === 'Close graph filters')!;
    fireEvent.click(closeButton);
    expect(mockProps.onClose).toHaveBeenCalled();
  });

  it('should call setEnabledSeries when a metric button is clicked', () => {
    const { getAllByText } = render(<UsageFilterMenu {...mockProps} />);
    const metricButton = getAllByText('Tokens')[0];
    fireEvent.click(metricButton);
    expect(mockProps.setEnabledSeries).toHaveBeenCalled();
  });

  it('should not allow disabling the last enabled series', () => {
    cleanup();
    const setEnabledSeriesSpy = vi.fn();
    const singleSeriesProps = {
      ...mockProps,
      enabledSeries: { tokens: true, active: false }, setEnabledSeries: setEnabledSeriesSpy
    };
    const { getAllByText, getByText } = render(<UsageFilterMenu {...singleSeriesProps} />);
    setEnabledSeriesSpy.mockClear();

    // Check live region
    expect(getByText('Showing 1 filter')).toBeTruthy();

    const tokensButton = getAllByText('Tokens')[0].closest('button');
    expect(tokensButton!.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(tokensButton!);
    expect(setEnabledSeriesSpy).not.toHaveBeenCalled();
  });
});
