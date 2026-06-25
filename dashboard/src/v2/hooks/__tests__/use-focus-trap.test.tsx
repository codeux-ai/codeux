// @vitest-environment jsdom
import { h, Fragment } from "preact";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/preact";
import { useFocusTrap } from "../use-focus-trap.js";
import { expect, test, describe, afterEach, vi } from "vitest";

describe("useFocusTrap", () => {
  afterEach(() => {
    cleanup();
  });

  const TestComponent = ({ active, onClose, empty = false, initialFocusRef, restoreFocus = true }: any) => {
    const trapRef = useFocusTrap(active, { onClose, initialFocusRef, restoreFocus });
    return (
      <div>
        <button id="outside">Outside</button>
        {active && (
          <div ref={trapRef as any} data-testid="trap">
            {!empty && (
              <Fragment>
                <button id="inside1">Inside 1</button>
                <button id="inside2">Inside 2</button>
              </Fragment>
            )}
            {empty && <div id="empty-content">Empty</div>}
          </div>
        )}
      </div>
    );
  };

  test("traps focus and handles Escape", async () => {
    const onClose = vi.fn();
    render(<TestComponent active={true} onClose={onClose} />);

    // Test Escape key
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  test("prevents focus escape when tabbing in empty trap", async () => {
    const onClose = vi.fn();
    render(<TestComponent active={true} onClose={onClose} empty={true} />);

    // Test Tab key on empty trap - shouldn't focus outside
    fireEvent.keyDown(document, { key: "Tab" });
    const outside = document.getElementById("outside");
    expect(document.activeElement).not.toBe(outside);
  });

  test("initial focus targets ref", async () => {
    const initialFocusRef = { current: null };
    render(
      <div>
        <input ref={(el: any) => initialFocusRef.current = el} id="initial-focus-input" />
        <TestComponent active={true} onClose={() => {}} initialFocusRef={initialFocusRef} />
      </div>
    );

    await waitFor(() => {
      expect(document.activeElement?.id).toBe("initial-focus-input");
    });
  });

  test("Tab wraparound works forward", async () => {
    render(<TestComponent active={true} onClose={() => {}} />);

    // First, let the hook automatically focus the first element (inside1)
    await waitFor(() => {
      expect(document.activeElement?.id).toBe("inside1");
    });

    const inside1 = document.getElementById("inside1");
    const inside2 = document.getElementById("inside2");

    // Focus last element
    inside2?.focus();

    // Press Tab
    fireEvent.keyDown(document, { key: "Tab" });

    // Should wrap around to first element
    expect(document.activeElement?.id).toBe("inside1");
  });

  test("Tab wraparound works backward (Shift+Tab)", async () => {
    render(<TestComponent active={true} onClose={() => {}} />);

    // First, let the hook automatically focus the first element (inside1)
    await waitFor(() => {
      expect(document.activeElement?.id).toBe("inside1");
    });

    const inside1 = document.getElementById("inside1");
    const inside2 = document.getElementById("inside2");

    // Press Shift+Tab on first element
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

    // Should wrap around to last element
    expect(document.activeElement?.id).toBe("inside2");
  });

  test("restores focus on close", async () => {
    // We simulate a button click that triggers the component to mount, meaning trigger is document.activeElement
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(<TestComponent active={true} onClose={() => {}} />);

    // Unmount closes the trap
    unmount();

    // Wait for the restore timeout
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });
});
