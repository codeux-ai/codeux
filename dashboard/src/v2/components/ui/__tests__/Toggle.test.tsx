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
    const onChange = vi.fn();
    render(<Toggle value={false} onChange={onChange} aria-label="Toggle Z" disabled />);

    const toggle = screen.getByRole('switch', { name: 'Toggle Z' });
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
});

test('suppresses aria-disabled activation while preserving the switch name and state', () => {
    const onChange = vi.fn();
    render(<Toggle value={false} onChange={onChange} aria-label="Toggle blocked setting" aria-disabled="true" aria-describedby="blocked-toggle-reason" />);

    const toggle = screen.getByRole('switch', { name: 'Toggle blocked setting' });
    fireEvent.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
    expect(toggle).not.toBeDisabled();
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    expect(toggle).toHaveAttribute('aria-describedby', 'blocked-toggle-reason');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('uses signal focus unless danger is requested', () => {
    render(
        <div>
            <Toggle value={false} onChange={vi.fn()} aria-label="Standard toggle" />
            <Toggle value={true} onChange={vi.fn()} aria-label="Danger toggle" danger />
        </div>
    );

    expect(screen.getByRole('switch', { name: 'Standard toggle' })).toHaveClass('focus-visible:ring-[var(--focus-ring-signal)]');
    expect(screen.getByRole('switch', { name: 'Danger toggle' })).toHaveClass('focus-visible:ring-[var(--focus-ring-danger)]');
});

test('uses tokenized transition duration', () => {
    render(<Toggle value={false} onChange={vi.fn()} aria-label="Token toggle" />);

    const toggle = screen.getByRole('switch', { name: 'Token toggle' });
    expect(toggle).toHaveStyle({
        transitionDuration: '150ms',
        transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
    });
});

test('respects reduced motion', () => {
    // We already mock ResizeObserver globally, to test useReducedMotion we can mock matchMedia
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation(query => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));

    render(<Toggle value={true} onChange={vi.fn()} aria-label="Toggle Reduced" />);

    const toggle = screen.getByRole('switch', { name: 'Toggle Reduced' });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toHaveClass('motion-reduce:duration-0');
    expect(toggle).toHaveStyle({
        transitionDuration: '0ms',
        transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
    });
    expect(toggle.querySelector('svg')).toBeInTheDocument();

    window.matchMedia = originalMatchMedia;
});
