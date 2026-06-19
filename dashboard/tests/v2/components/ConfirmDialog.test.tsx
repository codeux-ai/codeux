/** @jsx h */
// @vitest-environment jsdom
import { h } from "preact";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/preact";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ConfirmDialog } from "../../../src/v2/components/ui/ConfirmDialog.js";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    fromTo: (_el: any, _from: any, to: any) => {
      if (to.onComplete) to.onComplete();
      return { revert: () => {} };
    },
    to: (_el: any, to: any) => {
      if (to.onComplete) to.onComplete();
      return { revert: () => {} };
    },
    context: (cb: any) => {
      cb();
      return { revert: () => {} };
    },
    set: () => {},
  },
}));

describe("ConfirmDialog", () => {
  const defaultOptions = {
    title: "Delete Project?",
    body: "This action cannot be undone.",
    confirmLabel: "Delete",
    cancelLabel: "Cancel",
    destructive: true,
  };

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <ConfirmDialog isOpen={false} options={defaultOptions} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("displays the correct title and body when open", () => {
    render(
      <ConfirmDialog isOpen={true} options={defaultOptions} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Delete Project?")).toBeInTheDocument();
    expect(screen.getByText("This action cannot be undone.")).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button is held (destructive)", async () => {
    vi.useFakeTimers();
    const handleConfirm = vi.fn();
    render(
      <ConfirmDialog isOpen={true} options={defaultOptions} onConfirm={handleConfirm} onCancel={vi.fn()} />
    );
    
    const confirmBtn = screen.getByRole("button", { name: /Hold to Delete|Delete/ });
    fireEvent.pointerDown(confirmBtn);
    
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    
    expect(handleConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm when confirm button is clicked (non-destructive)", () => {
    const handleConfirm = vi.fn();
    render(
      <ConfirmDialog 
        isOpen={true} 
        options={{...defaultOptions, destructive: false}} 
        onConfirm={handleConfirm} 
        onCancel={vi.fn()} 
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(handleConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when cancel button is clicked", () => {
    const handleCancel = vi.fn();
    render(
      <ConfirmDialog isOpen={true} options={defaultOptions} onConfirm={vi.fn()} onCancel={handleCancel} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(handleCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Escape key is pressed", () => {
    const handleCancel = vi.fn();
    render(
      <ConfirmDialog isOpen={true} options={defaultOptions} onConfirm={vi.fn()} onCancel={handleCancel} />
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(handleCancel).toHaveBeenCalledTimes(1);
  });
});


describe("ConfirmDialog with additional test cases", () => {
  const defaultOptions = {
    title: "Delete Project?",
    body: "This action cannot be undone.",
    confirmLabel: "Delete",
    cancelLabel: "Cancel",
    destructive: true,
  };

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("clarifies action on confirm by displaying visually distinct state (action clarity)", () => {
    vi.useFakeTimers();
    const handleConfirm = vi.fn();
    render(
      <ConfirmDialog isOpen={true} options={{...defaultOptions, destructive: false}} onConfirm={handleConfirm} onCancel={vi.fn()} />
    );

    const btn = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(btn);

    act(() => {
        vi.advanceTimersByTime(100);
    });

    // Check that button switches to processing state immediately
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Processing...")).toBeInTheDocument();
  });

  it("bypasses transition via reduced-motion for GSAP calls", async () => {
    const gsapMock = await import("gsap");
    const fromToSpy = vi.spyOn(gsapMock.default, 'fromTo');

    // We mock matchMedia to force reduced motion
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    render(
      <ConfirmDialog isOpen={true} options={defaultOptions} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );

    // Using vitest assertion to check that the gsap calls had duration 0
    expect(fromToSpy).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        expect.anything(),
        expect.objectContaining({ duration: 0 })
    );

    // cleanup mock
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    fromToSpy.mockRestore();
  });
});
