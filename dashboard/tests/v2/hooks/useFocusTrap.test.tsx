/** @vitest-environment jsdom */
import { render, fireEvent, screen, act } from "@testing-library/preact";
import { useState, useRef } from "preact/hooks";
import { useFocusTrap } from "../../../src/v2/hooks/use-focus-trap.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const TestComponent = ({
  active = true,
  onClose,
  restoreFocus = true,
  hiddenContent = false,
}: {
  active?: boolean;
  onClose?: () => void;
  restoreFocus?: boolean;
  hiddenContent?: boolean;
}) => {
  const containerRef = useFocusTrap(active, { onClose, restoreFocus });

  return (
    <div>
      <button data-testid="trigger">Trigger</button>
      {active && (
        <div ref={containerRef} data-testid="trap-container">
          <button data-testid="first">First</button>
          <input data-testid="second" />
          {hiddenContent && (
            <>
              <button hidden data-testid="hidden-btn">Hidden</button>
              <button disabled data-testid="disabled-btn">Disabled</button>
              <div inert>
                <button data-testid="inert-btn">Inert</button>
              </div>
              <div aria-hidden="true">
                 <button data-testid="aria-hidden-btn">Aria Hidden</button>
              </div>
              <button tabIndex={-1} data-testid="negative-tabindex-btn">Negative TabIndex</button>
            </>
          )}
          <button data-testid="last">Last</button>
        </div>
      )}
    </div>
  );
};

describe("useFocusTrap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("should capture initial focus", async () => {
    render(<TestComponent active={true} />);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    const first = screen.getByTestId("first");
    expect(document.activeElement).toBe(first);
  });

  it("should wrap focus on Tab", () => {
    render(<TestComponent active={true} />);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    const first = screen.getByTestId("first");
    const last = screen.getByTestId("last");

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    last.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: false });
    expect(document.activeElement).toBe(first);
  });

  it("should call onClose on Escape", () => {
    const onClose = vi.fn();
    render(<TestComponent active={true} onClose={onClose} />);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("should ignore hidden, disabled, inert, and aria-hidden elements", () => {
    render(<TestComponent active={true} hiddenContent={true} />);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    const first = screen.getByTestId("first");
    const last = screen.getByTestId("last");

    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last); // Should skip the hidden ones

    last.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: false });
    expect(document.activeElement).toBe(first); // Should skip the hidden ones
  });

  it("should restore focus when unmounted", () => {
    // Render inactive first, focus the trigger, then render active
    const { rerender } = render(<TestComponent active={false} />);

    // Simulate user clicking a trigger before it opens
    const trigger = screen.getByTestId("trigger");
    trigger.focus();

    // Open the modal
    rerender(<TestComponent active={true} />);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(document.activeElement).toBe(screen.getByTestId("first"));

    // Close the modal instead of unmounting the whole component
    rerender(<TestComponent active={false} />);

    act(() => {
      vi.advanceTimersByTime(100); // the restore focus timer
    });

    expect(document.activeElement).toBe(trigger);
  });
});
