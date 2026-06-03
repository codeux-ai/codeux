// @vitest-environment jsdom
import { expect, test, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/preact";
import { Button, SHARED_INTERACTION_CLASSES } from "../Button.js";

afterEach(() => {
    cleanup();
});

test('Button component has correct interaction classes', () => {
    const { getByRole } = render(<Button>Test</Button>);
    const button = getByRole('button');
    
    // Check for some key classes from SHARED_INTERACTION_CLASSES
    expect(button.className).toContain('active:scale-[0.97]');
    expect(button.className).toContain('focus-visible:ring-signal-500/50');
    expect(button.className).toContain('disabled:opacity-40');
    expect(button.className).toContain('transition-[transform,background-color,border-color,color,box-shadow,opacity]');
});

test('Button component respects disabled prop', () => {
    const { getByRole } = render(<Button disabled>Disabled</Button>);
    const button = getByRole('button') as HTMLButtonElement;
    
    expect(button.disabled).toBe(true);
    expect(button.className).toContain('disabled:opacity-40');
});

test('SHARED_INTERACTION_CLASSES contains expected styles', () => {
    expect(SHARED_INTERACTION_CLASSES).toContain('active:scale-[0.97]');
    expect(SHARED_INTERACTION_CLASSES).toContain('focus-visible:ring-signal-500/50');
    expect(SHARED_INTERACTION_CLASSES).toContain('disabled:opacity-40');
});
