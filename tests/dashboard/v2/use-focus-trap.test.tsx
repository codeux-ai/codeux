/** @vitest-environment happy-dom */
/** @jsx h */
import { h, Fragment } from "preact";
import { render, screen, fireEvent, cleanup } from "@testing-library/preact";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useFocusTrap } from "../../../dashboard/src/v2/hooks/use-focus-trap.js";
import { useRef, useState } from "preact/hooks";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

function TestComponent({
  active = true,
  onClose = vi.fn(),
  restoreFocus = true,
  children,
  initialFocusRef
}: any) {
  const ref = useFocusTrap(active, { onClose, restoreFocus, initialFocusRef });
  return <div ref={ref} data-testid="trap">{children}</div>;
}

describe("useFocusTrap", () => {
  beforeEach(() => {
    cleanup();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("traps focus inside the container", () => {
    render(
      <TestComponent>
        <button id="btn1">1</button>
        <button id="btn2">2</button>
      </TestComponent>
    );

    const btn1 = document.getElementById("btn1")!;
    const btn2 = document.getElementById("btn2")!;

    vi.advanceTimersByTime(100);
    expect(document.activeElement).toBe(btn1);

    // Tab from last to first
    btn2.focus();
    fireEvent.keyDown(document, { key: "Tab", code: "Tab" });
    expect(document.activeElement).toBe(btn1);

    // Shift+Tab from first to last
    fireEvent.keyDown(document, { key: "Tab", code: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(btn2);
  });

  it("restores focus to connected trigger element when closed", () => {
    const trigger = document.createElement("button");
    trigger.id = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <TestComponent active={true}>
        <button id="btn1">1</button>
      </TestComponent>
    );
    vi.advanceTimersByTime(100);
    expect(document.activeElement).not.toBe(trigger);

    rerender(<TestComponent active={false}><button id="btn1">1</button></TestComponent>);
    vi.advanceTimersByTime(100);
    expect(document.activeElement).toBe(trigger);

    document.body.removeChild(trigger);
  });

  it("does not crash if trigger is disconnected on restore", () => {
    const trigger = document.createElement("button");
    trigger.id = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <TestComponent active={true}>
        <button id="btn1">1</button>
      </TestComponent>
    );
    vi.advanceTimersByTime(100);
    expect(document.activeElement).not.toBe(trigger);

    // Remove the trigger from DOM before unmounting
    document.body.removeChild(trigger);

    unmount();
    vi.advanceTimersByTime(100);

    // Focus should not crash and should not be the trigger
    expect(document.activeElement).not.toBe(trigger);
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <TestComponent onClose={onClose}>
        <button id="btn1">1</button>
      </TestComponent>
    );
    vi.advanceTimersByTime(100);

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose if Escape propagation was stopped by nested component", () => {
    const onClose = vi.fn();
    render(
      <TestComponent onClose={onClose}>
        <input
          id="nested"
          onKeyDown={(e) => {
             if (e.key === 'Escape') {
                 e.preventDefault();
                 e.stopPropagation();
             }
          }}
        />
      </TestComponent>
    );
    vi.advanceTimersByTime(100);
    const nested = document.getElementById("nested")!;
    nested.focus();

    // Simulate escape keydown on the nested element
    fireEvent.keyDown(nested, { key: "Escape", code: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not leak focus when empty and prevents default tab", () => {
     render(
      <TestComponent>
      </TestComponent>
    );
    vi.advanceTimersByTime(100);
    const beforeFocus = document.activeElement;

    const event = new KeyboardEvent("keydown", { key: "Tab", code: "Tab", bubbles: true, cancelable: true });
    fireEvent(document, event);
    expect(document.activeElement).toBe(beforeFocus);
    expect(event.defaultPrevented).toBe(true);
  });

  it("forces focus back when it escapes container", () => {
     render(
      <>
        <button id="outside">out</button>
        <TestComponent>
          <button id="btn1">1</button>
        </TestComponent>
      </>
    );

    const outside = document.getElementById("outside")!;
    const btn1 = document.getElementById("btn1")!;
    vi.advanceTimersByTime(100);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    fireEvent.keyDown(document, { key: "Tab", code: "Tab" });
    expect(document.activeElement).toBe(btn1);
  });

  it("ignores disabled elements", () => {
    render(
      <TestComponent active={true}>
        <button id="btn1" disabled>1</button>
        <button id="btn2">2</button>
      </TestComponent>
    );
    vi.advanceTimersByTime(100);
    const btn2 = document.getElementById("btn2");
    expect(document.activeElement).toBe(btn2);

    // Tab shouldn't focus btn1
    fireEvent.keyDown(document, { key: "Tab", code: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(btn2);
  });

  it("prefers autofocus element on open", () => {
    render(
      <TestComponent active={true}>
        <button id="btn1">1</button>
        <button id="btn2" autoFocus>2</button>
      </TestComponent>
    );
    vi.advanceTimersByTime(100);
    const btn2 = document.getElementById("btn2");
    expect(document.activeElement).toBe(btn2);
  });

});
