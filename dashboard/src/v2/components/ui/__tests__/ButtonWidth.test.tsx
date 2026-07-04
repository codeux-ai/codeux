/** @vitest-environment happy-dom */
import { render, screen, cleanup } from '@testing-library/preact';
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
    // Note: in happy-dom, layout styles like offsetWidth are 0, so style.width will be 0px
    render(
        <ProjectDataProvider>
            <Button pending>Fixed width check</Button>
        </ProjectDataProvider>
    );

    const btn = screen.getByRole('button', { name: /Fixed width check/i });
    expect(btn).toHaveStyle('width: 0px');
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

test('keeps action variants tokenized and visually distinct', () => {
    render(
        <ProjectDataProvider>
            <Button variant="primary">Primary</Button>
            <Button variant="signal">Signal</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="danger">Delete</Button>
        </ProjectDataProvider>
    );

    const primary = screen.getByRole('button', { name: /Primary/i });
    const signal = screen.getByRole('button', { name: /Signal/i });
    const secondary = screen.getByRole('button', { name: /Secondary/i });
    const danger = screen.getByRole('button', { name: /Delete/i });

    expect(primary).toHaveClass('bg-signal-600', 'text-white', 'shadow-[var(--elevation-raised)]');
    expect(primary.className).not.toContain('bg-slate-900');
    expect(primary.className).not.toContain('hover:bg-black');
    expect(signal).toHaveClass('bg-signal-500', 'text-void-950');
    expect(secondary).toHaveClass('bg-[var(--surface-glass)]', 'border-[color:var(--border-hairline)]');
    expect(danger).toHaveClass('bg-status-red/[0.06]', 'text-status-red');
});

test('keeps icon and label alignment stable for dynamic states', () => {
    render(
        <ProjectDataProvider>
            <Button icon={Check} pending>Aligned button label</Button>
        </ProjectDataProvider>
    );

    const btn = screen.getByRole('button', { name: /Aligned button label/i });
    const label = btn.querySelector('span');
    const iconSlot = btn.querySelector('[data-active]');

    expect(btn).toHaveClass('min-w-0');
    expect(label).toHaveClass('truncate', 'min-w-0');
    expect(iconSlot?.parentElement).toHaveClass('shrink-0');
});
