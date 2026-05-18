/**
 * @vitest-environment jsdom
 */
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { TopRowFilters } from '../TopRowFilters';
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

describe('TopRowFilters', () => {
  afterEach(() => {
    cleanup();
  });

  const availableTags = [
    { value: 'bug', label: 'bug' },
    { value: 'feature', label: 'feature' },
  ];

  it('renders correctly', () => {
    const { getByText } = render(
      <TopRowFilters selectedTags={[]} onTagsChange={() => {}} availableTags={availableTags} />
    );
    expect(getByText('Filter by GitHub tags...')).toBeInTheDocument();
  });

  it('updates selected tags', () => {
    const onTagsChange = vi.fn();
    const { getByText } = render(
      <TopRowFilters selectedTags={[]} onTagsChange={onTagsChange} availableTags={availableTags} />
    );
    fireEvent.click(getByText('Filter by GitHub tags...'));
    fireEvent.click(getByText('bug'));
    expect(onTagsChange).toHaveBeenCalledWith(['bug']);
  });
});
