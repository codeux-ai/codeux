// @vitest-environment jsdom
import { h } from "preact";
import { useState } from "preact/hooks";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/preact";
import { Drawer } from "../Drawer.js";
import { expect, test, describe, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("gsap", () => {
  const gsap = {
    fromTo: vi.fn((_target, _from, to) => {
      to?.onComplete?.();
      return { kill: vi.fn() };
    }),
    to: vi.fn((_target, to) => {
      to?.onComplete?.();
      return { kill: vi.fn() };
    }),
    timeline: vi.fn((options?: { onComplete?: () => void }) => {
      const timeline = {
        to: vi.fn(() => {
          options?.onComplete?.();
          return timeline;
        }),
      };
      return timeline;
    }),
    killTweensOf: vi.fn(),
    context: vi.fn(() => ({ add: (callback: () => void) => callback(), revert: vi.fn() })),
  };
  return { default: gsap, gsap };
});

function setReducedMotion(matches: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)" ? matches : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function DrawerHarness() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <main>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open drawer
      </button>
      <Drawer isOpen={isOpen} onClose={() => setIsOpen(false)} ariaLabel="Focusable drawer">
        <button type="button" onClick={() => setIsOpen(false)}>
          Close drawer
        </button>
      </Drawer>
    </main>
  );
}

describe("Drawer", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("renders with fallback accessible name 'Drawer'", () => {
    render(
      <Drawer isOpen={true} onClose={() => {}}>
        <div>Content</div>
      </Drawer>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Drawer");
  });

  test("renders with provided ariaLabel", () => {
    render(
      <Drawer isOpen={true} onClose={() => {}} ariaLabel="Sprint settings">
        <div>Content</div>
      </Drawer>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Sprint settings");
  });

  test("does not add fallback if aria-labelledby is provided", () => {
    render(
      <Drawer isOpen={true} onClose={() => {}} ariaLabelledBy="title-id">
        <h1 id="title-id">Title</h1>
      </Drawer>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBeNull();
    expect(dialog.getAttribute("aria-labelledby")).toBe("title-id");
  });

  test("omits aria-describedby when not provided", () => {
    render(
      <Drawer isOpen={true} onClose={() => {}}>
        <div>Content</div>
      </Drawer>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.hasAttribute("aria-describedby")).toBe(false);
  });

  test("Escape closes the drawer and restores focus to the trigger", async () => {
    render(<DrawerHarness />);

    const trigger = screen.getByRole("button", { name: "Open drawer" });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "Focusable drawer" });

    const escapeEvent = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(escapeEvent);

    expect(escapeEvent.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  test("uses reduced-motion drawer animation durations", async () => {
    setReducedMotion(true);
    const { rerender } = render(
      <Drawer isOpen={true} onClose={() => {}} ariaLabel="Reduced drawer">
        <div>Content</div>
      </Drawer>
    );

    expect(screen.getByRole("dialog", { name: "Reduced drawer" })).toBeInTheDocument();
    await waitFor(async () => {
      const gsap = (await import("gsap")).default;
      expect(vi.mocked(gsap.fromTo).mock.calls.some(([, , to]) => to?.duration === 0)).toBe(true);
    });

    rerender(
      <Drawer isOpen={false} onClose={() => {}} ariaLabel="Reduced drawer">
        <div>Content</div>
      </Drawer>
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Reduced drawer" })).toBeNull();
    });
  });
});
