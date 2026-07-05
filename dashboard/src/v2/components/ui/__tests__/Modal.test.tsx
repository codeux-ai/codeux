// @vitest-environment jsdom
import { h } from "preact";
import { useState } from "preact/hooks";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/preact";
import { Modal } from "../Modal.js";
import { Popover } from "../Popover.js";
import { expect, test, describe, afterEach, vi } from "vitest";

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

function ModalHarness() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <main>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open modal
      </button>
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} ariaLabel="Focusable modal">
        <button type="button" onClick={() => setIsOpen(false)}>
          Close modal
        </button>
      </Modal>
    </main>
  );
}

function PopoverHarness() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      ariaLabel="Runtime options"
      content={
        <button type="button" onClick={() => setIsOpen(false)}>
          Popover action
        </button>
      }
    >
      <button type="button">Open popover</button>
    </Popover>
  );
}

describe("Modal", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("does not add a generic fallback name", () => {
    render(
      <Modal isOpen={true} onClose={() => {}}>
        <div>Content</div>
      </Modal>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBeNull();
    expect(dialog.getAttribute("aria-labelledby")).toBeNull();
  });

  test("uses explicit aria-label as accessible name", () => {
    render(
      <Modal isOpen={true} onClose={() => {}} ariaLabel="Project settings">
        <div>Content</div>
      </Modal>
    );
    const dialog = screen.getByRole("dialog", { name: "Project settings" });
    expect(dialog.getAttribute("aria-label")).toBe("Project settings");
  });

  test("does not add fallback if aria-labelledby is provided", () => {
    render(
      <Modal isOpen={true} onClose={() => {}} ariaLabelledBy="title-id">
        <h1 id="title-id">Title</h1>
      </Modal>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBeNull();
    expect(dialog.getAttribute("aria-labelledby")).toBe("title-id");
  });

  test("uses titleId for visible title labelling", () => {
    render(
      <Modal isOpen={true} onClose={() => {}} titleId="modal-title">
        <h1 id="modal-title">Create Project</h1>
      </Modal>
    );
    const dialog = screen.getByRole("dialog", { name: "Create Project" });
    expect(dialog.getAttribute("aria-labelledby")).toBe("modal-title");
  });

  test("omits aria-describedby when not provided", () => {
    render(
      <Modal isOpen={true} onClose={() => {}}>
        <div>Content</div>
      </Modal>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.hasAttribute("aria-describedby")).toBe(false);
  });

  test("restores focus to the trigger after an action closes it", async () => {
    render(<ModalHarness />);

    const trigger = screen.getByRole("button", { name: "Open modal" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "Close modal" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  test("uses reduced-motion modal animation duration and exits cleanly", async () => {
    setReducedMotion(true);
    const { rerender } = render(
      <Modal isOpen={true} onClose={() => {}} ariaLabel="Reduced modal">
        <div>Content</div>
      </Modal>
    );

    expect(screen.getByRole("dialog", { name: "Reduced modal" })).toBeInTheDocument();
    await waitFor(async () => {
      const gsap = (await import("gsap")).default;
      expect(vi.mocked(gsap.fromTo).mock.calls.some(([, , to]) => to?.duration === 0)).toBe(true);
    });

    rerender(
      <Modal isOpen={false} onClose={() => {}} ariaLabel="Reduced modal">
        <div>Content</div>
      </Modal>
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Reduced modal" })).toBeNull();
    });
  });

  test("popover Escape closes without default key handling and restores focus", async () => {
    render(<PopoverHarness />);

    const trigger = screen.getByRole("button", { name: "Open popover" });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "Runtime options" });

    const escapeEvent = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(escapeEvent);

    expect(escapeEvent.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });
});
