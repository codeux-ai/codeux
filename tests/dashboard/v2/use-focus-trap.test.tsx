/** @vitest-environment jsdom */
/** @jsx h */
/** @jsxFrag Fragment */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, Fragment } from "preact";
import { render, cleanup, fireEvent, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { useFocusTrap } from "../../../dashboard/src/v2/hooks/use-focus-trap.js";
import { useRef } from "preact/hooks";

expect.extend(matchers);

const TestComponent = ({ active, onClose }: { active: boolean, onClose?: () => void }) => {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(active, onClose, ref);

  return (
    <div ref={ref} data-testid="container">
      <button data-testid="btn1">Button 1</button>
      <input data-testid="input1" />
      <button data-testid="btn2">Button 2</button>
    </div>
  );
};

const EmptyComponent = ({ active }: { active: boolean }) => {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(active, vi.fn(), ref);
  return <div ref={ref} data-testid="container"></div>;
};

describe("useFocusTrap", () => {
  beforeEach(() => {
    cleanup();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should focus the first focusable element when active", () => {
    render(
      <div>
        <button data-testid="outside">Outside</button>
        <TestComponent active={true} />
      </div>
    );

    vi.runAllTimers();

    const btn1 = screen.getByTestId("btn1");
    expect(document.activeElement).toBe(btn1);
  });

  it("should trap focus on tab", () => {
    render(<TestComponent active={true} />);
    vi.runAllTimers();

    const btn1 = screen.getByTestId("btn1");
    const input1 = screen.getByTestId("input1");
    const btn2 = screen.getByTestId("btn2");

    // First element is focused
    expect(document.activeElement).toBe(btn1);

    // Tab on the last element should wrap to the first
    btn2.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: false });
    expect(document.activeElement).toBe(btn1);

    // Shift+Tab on the first element should wrap to the last
    btn1.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(btn2);
  });

  it("should prevent focus from escaping", () => {
    render(
      <div>
        <button data-testid="outside">Outside</button>
        <TestComponent active={true} />
      </div>
    );
    vi.runAllTimers();

    const outsideBtn = screen.getByTestId("outside");
    const btn1 = screen.getByTestId("btn1");

    outsideBtn.focus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: false });
    expect(document.activeElement).toBe(btn1);
  });

  it("should not focus anything if container has no focusable elements", () => {
    render(<EmptyComponent active={true} />);
    vi.runAllTimers();
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(document, { key: "Tab", shiftKey: false });
    expect(document.activeElement).toBe(document.body);
  });

  it("should call onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<TestComponent active={true} onClose={onClose} />);
    vi.runAllTimers();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });


  it("should handle triggerRef cleanup when trap is removed", () => {
    const outsideBtn = document.createElement("button");
    document.body.appendChild(outsideBtn);
    outsideBtn.focus();

    const { unmount } = render(<TestComponent active={true} />);
    vi.runAllTimers();
    const btn1 = screen.getByTestId("btn1");
    expect(document.activeElement).toBe(btn1);

    // Simulate removing the trap
    unmount();

    // The triggerRef should receive focus back
    expect(document.activeElement).toBe(outsideBtn);
    document.body.removeChild(outsideBtn);
  });
});

  it("should handle tab correctly if nothing is focused initially", () => { vi.useFakeTimers();
    render(<TestComponent active={true} />);
    vi.runAllTimers();

    // Nothing focused specifically
    (document.activeElement as HTMLElement).blur();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: false });

    const btn1 = screen.getByTestId("btn1");
    expect(document.activeElement).toBe(btn1);
  });

  it("should handle tab wrapper check", () => { cleanup();
    vi.useFakeTimers();
    render(
      <div>
        <button data-testid="outside">Outside</button>
        <TestComponent active={true} />
      </div>
    );

    vi.runAllTimers();

    const btn1 = screen.getByTestId("btn1");
    btn1.focus();

    // Simulate Tab when there are focusable elements but focus hasn't escaped yet
    fireEvent.keyDown(document, { key: "Tab", shiftKey: false });
    // Tab behavior on btn1 shouldn't trigger escape force
    expect(document.activeElement).toBe(btn1);
  });
