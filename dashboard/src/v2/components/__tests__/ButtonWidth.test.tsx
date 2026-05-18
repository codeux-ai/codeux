// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/preact";
import { Button } from "../ui/Button.js";

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
