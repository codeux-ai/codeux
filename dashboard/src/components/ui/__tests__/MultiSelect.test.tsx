/**
 * @vitest-environment jsdom
 */
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { MultiSelect } from '../MultiSelect';
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

describe('MultiSelect', () => {
  afterEach(() => {
    cleanup();
  });

  const options = [
    { value: 'bug', label: 'bug' },
    { value: 'feature', label: 'feature' },
  ];

  it('renders correctly', () => {
    const { getByText } = render(
      <MultiSelect options={options} value={[]} onChange={() => {}} placeholder="Select tag" />
    );
    expect(getByText('Select tag')).toBeInTheDocument();
  });

  it('opens dropdown on click', () => {
    const { getByText } = render(
      <MultiSelect options={options} value={[]} onChange={() => {}} />
    );
    fireEvent.click(getByText('Select...'));
    expect(getByText('bug')).toBeInTheDocument();
    expect(getByText('feature')).toBeInTheDocument();
  });

  it('has correct aria properties', () => {
    const { getByRole } = render(
      <MultiSelect options={options} value={['bug']} onChange={() => {}} ariaLabel="Tag selection" />
    );
    const combobox = getByRole('combobox');
    expect(combobox).toHaveAttribute('aria-label', 'Tag selection');
    expect(combobox).toHaveAttribute('aria-describedby');
  });

  it('announces added tags', () => {
    const onChange = vi.fn();
    const { getByText } = render(
      <MultiSelect options={options} value={[]} onChange={onChange} />
    );
    fireEvent.click(getByText('Select...'));
    fireEvent.click(getByText('bug'));
    expect(onChange).toHaveBeenCalledWith(['bug']);
    expect(getByText('Added bug')).toBeInTheDocument();
  });

  it('selects an option', () => {
    const onChange = vi.fn();
    const { getByText } = render(
      <MultiSelect options={options} value={[]} onChange={onChange} />
    );
    fireEvent.click(getByText('Select...'));
    fireEvent.click(getByText('bug'));
    expect(onChange).toHaveBeenCalledWith(['bug']);
  });
});
