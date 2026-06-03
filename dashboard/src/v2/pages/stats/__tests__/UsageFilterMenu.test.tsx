/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { UsageFilterMenu } from '../components/UsageFilterMenu.js';

describe('UsageFilterMenu', () => {
  const mockProps = {
    isOpen: true,
    onClose: vi.fn(),
    activeWindow: '7d',
    customFrom: '2026-04-20',
    customTo: '2026-04-27',
    onSelectPreset: vi.fn(),
    onCustomFromChange: vi.fn(),
    onCustomToChange: vi.fn(),
    onApplyCustom: vi.fn(),
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
    const { getByText, getAllByText } = render(<UsageFilterMenu {...mockProps} />);
    expect(getByText('Graph Filters')).toBeTruthy();
    expect(getByText('Time Window')).toBeTruthy();
    expect(getByText('Metric Series')).toBeTruthy();
  });

  it('should call onClose when close button is clicked', () => {
    const { getAllByRole } = render(<UsageFilterMenu {...mockProps} />);
    const closeButton = getAllByRole('button', { name: '' })[0]; // The X icon button
    fireEvent.click(closeButton);
    expect(mockProps.onClose).toHaveBeenCalled();
  });

  it('should call onSelectPreset when a preset button is clicked', () => {
    const { getByText, getAllByText } = render(<UsageFilterMenu {...mockProps} />);
    const presetButton1h = getAllByText('1h')[0];
    fireEvent.click(presetButton1h);
    expect(mockProps.onSelectPreset).toHaveBeenCalledWith('1h');

    const presetButton = getAllByText('24h')[0];
    fireEvent.click(presetButton);
    expect(mockProps.onSelectPreset).toHaveBeenCalledWith('24h');
  });

  it('should call onApplyCustom when apply button is clicked', () => {
    const { getByText, getAllByText } = render(<UsageFilterMenu {...mockProps} />);
    const applyButton = getAllByText('Apply Range')[0];
    fireEvent.click(applyButton);
    expect(mockProps.onApplyCustom).toHaveBeenCalled();
  });

  it('should call setEnabledSeries when a metric button is clicked', () => {
    const { getByText, getAllByText } = render(<UsageFilterMenu {...mockProps} />);
    const metricButton = getAllByText('Tokens')[0];
    fireEvent.click(metricButton);
    // It should call setEnabledSeries because tokens is currently enabled and there are 2 enabled series
    expect(mockProps.setEnabledSeries).toHaveBeenCalled();
  });

  it('should not allow disabling the last enabled series', () => {
    const setEnabledSeriesSpy = vi.fn();
    const singleSeriesProps = {
      ...mockProps,
      enabledSeries: { tokens: true, active: false }, setEnabledSeries: setEnabledSeriesSpy
    };
    const { getByText, getAllByText } = render(<UsageFilterMenu {...singleSeriesProps} />);
    setEnabledSeriesSpy.mockClear();
    const tokensButton = getAllByText('Tokens')[0].closest('button');
        expect(setEnabledSeriesSpy).not.toHaveBeenCalled();
    fireEvent.click(tokensButton!);
    expect(setEnabledSeriesSpy).not.toHaveBeenCalled();
  });
});
