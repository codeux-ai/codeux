/** @vitest-environment jsdom */
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { expect, test, vi, beforeAll, afterEach } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { FilterStrip } from '../FilterStrip.js';

expect.extend(matchers);

beforeAll(() => {
    class MockResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    window.ResizeObserver = MockResizeObserver;
});

afterEach(() => {
    cleanup();
});

test('renders correctly with string options', () => {
    const options = ['all', 'active', 'completed'] as const;
    const onChange = vi.fn();

    render(<FilterStrip options={options} active="all" onChange={onChange} />);

    expect(screen.getByRole('tablist')).toBeInTheDocument();

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);

    expect(tabs[0]).toHaveTextContent('all');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('tabindex', '0');

    expect(tabs[1]).toHaveTextContent('active');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');
});

test('renders correctly with object options', () => {
    const options = [
        { value: 'all', label: 'All Items' },
        { value: 'active', label: 'Active Items' }
    ] as const;
    const onChange = vi.fn();

    render(<FilterStrip options={options} active="active" onChange={onChange} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);

    expect(tabs[0]).toHaveTextContent('All Items');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');

    expect(tabs[1]).toHaveTextContent('Active Items');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
});

test('calls onChange when clicking a tab', () => {
    const options = ['a', 'b', 'c'] as const;
    const onChange = vi.fn();

    render(<FilterStrip options={options} active="a" onChange={onChange} />);

    const tabs = screen.getAllByRole('tab');
    fireEvent.click(tabs[1]);

    expect(onChange).toHaveBeenCalledWith('b');
});

test('navigates with keyboard arrows', () => {
    const options = ['a', 'b', 'c'] as const;
    const onChange = vi.fn();

    render(<FilterStrip options={options} active="a" onChange={onChange} />);

    const tabs = screen.getAllByRole('tab');

    // Focus first tab
    tabs[0].focus();
    expect(document.activeElement).toBe(tabs[0]);

    // Right arrow
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[1]);

    // End key
    fireEvent.keyDown(tabs[1], { key: 'End' });
    expect(document.activeElement).toBe(tabs[2]);

    // Home key
    fireEvent.keyDown(tabs[2], { key: 'Home' });
    expect(document.activeElement).toBe(tabs[0]);

    // Left arrow
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[2]);
});

test('renders clear button when showClear is true and onClear provided', () => {
    const options = ['a'] as const;
    const onChange = vi.fn();
    const onClear = vi.fn();

    const { rerender } = render(<FilterStrip options={options} active="a" onChange={onChange} showClear={true} onClear={onClear} />);

    const clearBtn = screen.getByText('Clear All');
    expect(clearBtn).toBeInTheDocument();

    fireEvent.click(clearBtn);
    expect(onClear).toHaveBeenCalled();

    // Rerender without showClear
    rerender(<FilterStrip options={options} active="a" onChange={onChange} showClear={false} onClear={onClear} />);
    expect(screen.queryByText('Clear All')).not.toBeInTheDocument();
});
