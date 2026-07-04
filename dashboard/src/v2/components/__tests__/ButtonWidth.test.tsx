// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/preact";
import { Button } from "../ui/Button.js";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

afterEach(() => {
    cleanup();
});

vi.mock("gsap", () => ({
    default: {
        fromTo: vi.fn(),
        to: vi.fn(),
        timeline: vi.fn(() => ({ to: vi.fn().mockReturnThis() })),
    },
}));

test('button locks width during loading and renders spinner', async () => {
    // Mock the offsetWidth for the ref
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 150 });

    const { getByRole, container, rerender } = render(
        <Button isLoading={false}>Action</Button>
    );

    const button = getByRole('button');
    expect(button.getAttribute('aria-busy')).not.toBe('true');
    expect(button.style.width).toBe('');

    rerender(
        <Button isLoading={true}>Action</Button>
    );

    const loadingButton = getByRole('button');
    expect(loadingButton.getAttribute('aria-busy')).toBe('true');
    // The width should be locked to offsetWidth
    expect(loadingButton.style.width).toBe('150px');
});

test('button keeps locked width during success feedback', () => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 150 });

    const { getByRole, rerender } = render(
        <Button success={false}>Saved</Button>
    );

    const button = getByRole('button');
    expect(button.style.width).toBe('');

    rerender(
        <Button success>Saved</Button>
    );

    expect(getByRole('button').style.width).toBe('150px');
});
