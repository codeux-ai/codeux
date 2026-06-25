/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { Tooltip } from "../../../src/v2/components/ui/Tooltip.js";

expect.extend(matchers);

describe("Tooltip", () => {
  afterEach(() => cleanup());

  it("applies triggerClassName to the trigger wrapper", () => {
    const { container } = render(
      <Tooltip content="More context" triggerClassName="h-full w-full">
        <button type="button">Hover me</button>
      </Tooltip>,
    );

    expect(container.firstElementChild).toHaveClass("h-full");
    expect(container.firstElementChild).toHaveClass("w-full");
  });
});

it("maintains a stable tooltip ID across re-renders", async () => {
  const { waitFor } = await import("@testing-library/preact");
  const userEvent = (await import("@testing-library/user-event")).default;
  const user = userEvent.setup();
  const { useState } = await import("preact/hooks");

  const TestComponent = () => {
    const [count, setCount] = useState(0);
    return (
      <div>
        <button type="button" onClick={() => setCount(c => c + 1)}>Increment: {count}</button>
        <Tooltip content="Stable content" delay={0}>
          <span data-testid="trigger">Hover me</span>
        </Tooltip>
      </div>
    );
  };

  const { getByText, getByTestId } = render(<TestComponent />);

  const trigger = getByTestId("trigger");
  await user.hover(trigger);

  const wrapper = trigger.parentElement;

  await waitFor(() => {
    expect(wrapper?.getAttribute("aria-describedby")).toBeTruthy();
  });

  const tooltipId = wrapper?.getAttribute("aria-describedby");
  expect(document.getElementById(tooltipId!)).toBeInTheDocument();

  const incrementButton = getByText(/Increment: 0/);
  await user.click(incrementButton);

  // Re-verify the ID matches and component is still rendering properly
  expect(wrapper?.getAttribute("aria-describedby")).toBe(tooltipId);
  expect(document.getElementById(tooltipId!)).toBeInTheDocument();
});

  it("is keyboard discoverable when focused", async () => {
    const { waitFor } = await import("@testing-library/preact");
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();

    const { getByTestId } = render(
      <Tooltip content="Keyboard hint" delay={0}>
        <button type="button" data-testid="kb-trigger">Focus me</button>
      </Tooltip>
    );

    const trigger = getByTestId("kb-trigger");
    trigger.focus();

    // the Tooltip checks for :focus-visible via standard DOM which JSDOM doesn't perfectly emulate in focus() alone,
    // but the test environment setup allows us to mock or bypass it if we mock the matches method:
    trigger.matches = (selector: string) => selector === ":focus-visible" || HTMLElement.prototype.matches.call(trigger, selector);

    const wrapper = trigger.parentElement!;
    wrapper.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

    await waitFor(() => {
      expect(wrapper.getAttribute("aria-describedby")).toBeTruthy();
    });

    const tooltipId = wrapper.getAttribute("aria-describedby");
    expect(document.getElementById(tooltipId!)).toBeInTheDocument();
  });
