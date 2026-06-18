/** @vitest-environment jsdom */
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { expect, test, vi, afterEach } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { Toggle } from '../Toggle.js';

expect.extend(matchers);

afterEach(() => {
    cleanup();
});

test('renders as a switch and announces state correctly', () => {
    const onChange = vi.fn();
    render(<Toggle value={true} onChange={onChange} aria-label="Enable Feature X" />);

    const toggle = screen.getByRole('switch', { name: 'Enable Feature X' });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
});

test('preserves aria-pressed if caller provides it', () => {
    render(<Toggle value={false} onChange={vi.fn()} aria-label="Toggle Y" aria-pressed="false" />);

    const toggle = screen.getByRole('switch', { name: 'Toggle Y' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('handles disabled controls', () => {
    render(<Toggle value={false} onChange={vi.fn()} aria-label="Toggle Z" disabled />);

    const toggle = screen.getByRole('switch', { name: 'Toggle Z' });
    expect(toggle).toBeDisabled();
});
