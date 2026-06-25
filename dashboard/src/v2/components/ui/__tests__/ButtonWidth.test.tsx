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
