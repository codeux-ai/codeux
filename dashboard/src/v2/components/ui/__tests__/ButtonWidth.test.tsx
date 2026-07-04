/** @vitest-environment happy-dom */
import { render, screen, cleanup, fireEvent } from '@testing-library/preact';
import { expect, test, afterEach, vi } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { Button } from '../Button.js';
import { Check } from 'lucide-preact';
import { ProjectDataProvider } from '../../../context/project-data.js';

expect.extend(matchers);

afterEach(() => {
    cleanup();
});

test('handles pending state and aria-attributes', () => {
    render(
        <ProjectDataProvider>
            <Button pending>Click me</Button>
        </ProjectDataProvider>
    );

    const btn = screen.getByRole('button', { name: /Click me/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toHaveAttribute('aria-disabled', 'true');
});

test('applies pending width adjustments correctly via style', () => {
    render(
        <ProjectDataProvider>
            <Button pending>Fixed width check</Button>
        </ProjectDataProvider>
    );

    const btn = screen.getByRole('button', { name: /Fixed width check/i });
    expect(btn).not.toHaveStyle('width: 0px');
    expect(btn).toHaveTextContent('Fixed width check');
});

test('renders custom icon', () => {
    render(
        <ProjectDataProvider>
            <Button icon={Check}>With Icon</Button>
        </ProjectDataProvider>
    );

    const btn = screen.getByRole('button', { name: /With Icon/i });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toHaveAttribute('aria-busy', 'true');
    // Ensure svg is rendered and hidden correctly using its class
    const svg = btn.querySelector('svg');
    expect(svg).toBeInTheDocument();
});

test('uses signal focus by default and danger focus only for danger variant', () => {
    render(
        <ProjectDataProvider>
            <div>
                <Button>Default focus</Button>
                <Button variant="danger">Delete</Button>
            </div>
        </ProjectDataProvider>
    );

    expect(screen.getByRole('button', { name: /Default focus/i })).toHaveClass('focus-visible:ring-[var(--focus-ring-signal)]');
    expect(screen.getByRole('button', { name: /Delete/i })).toHaveClass('focus-visible:ring-[var(--focus-ring-danger)]');
});

test('suppresses activation while pending, native disabled, or aria-disabled', () => {
    const onClick = vi.fn();
    const { rerender } = render(
        <ProjectDataProvider>
            <Button pending onClick={onClick}>Save changes</Button>
        </ProjectDataProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    expect(onClick).not.toHaveBeenCalled();

    rerender(
        <ProjectDataProvider>
            <Button disabled onClick={onClick}>Save changes</Button>
        </ProjectDataProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    expect(onClick).not.toHaveBeenCalled();

    rerender(
        <ProjectDataProvider>
            <Button aria-disabled="true" onClick={onClick}>Save changes</Button>
        </ProjectDataProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    expect(onClick).not.toHaveBeenCalled();
});

test('reduced motion snaps pending feedback while preserving static cues', () => {
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

    render(
        <ProjectDataProvider>
            <Button pending icon={Check}>Sync project</Button>
        </ProjectDataProvider>
    );

    const btn = screen.getByRole('button', { name: /Sync project/i });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toHaveStyle({
        transitionDuration: '0ms',
        transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
    });
    expect(btn.querySelector('.motion-reduce\\:animate-none')).toBeInTheDocument();

    window.matchMedia = originalMatchMedia;
});
