// @vitest-environment jsdom
import { h } from "preact";
import { useState } from "preact/hooks";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/preact";
import { Dialog } from "../Dialog.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { DropdownMenu, DropdownMenuItem } from "../DropdownMenu.js";
import { useConfirmDialog } from "../../../hooks/use-confirm-dialog.js";
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

function DialogHarness({ unmountTrigger = false }: { unmountTrigger?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <main data-testid="page-fallback">
      {(!unmountTrigger || !isOpen) && (
        <button type="button" onClick={() => setIsOpen(true)}>
          Open dialog
        </button>
      )}
      <Dialog isOpen={isOpen} onClose={() => setIsOpen(false)} ariaLabel="Focusable dialog">
        <button type="button" onClick={() => setIsOpen(false)}>
          Close dialog
        </button>
      </Dialog>
    </main>
  );
}

function ConfirmHarness({ onDecision }: { onDecision: (confirmed: boolean) => void }) {
  const confirm = useConfirmDialog();
  const openConfirm = async (): Promise<void> => {
    const confirmed = await confirm.requestConfirm({
      title: "Reset runtime state",
      body: "Reset the runtime state for this task?",
      confirmLabel: "Reset",
      cancelLabel: "Keep",
      tone: "warning",
    });
    onDecision(confirmed);
  };

  return (
    <main data-testid="confirm-fallback">
      <button type="button" onClick={() => void openConfirm()}>
        Open confirm
      </button>
      <ConfirmDialog
        isOpen={confirm.isOpen}
        options={confirm.options}
        onConfirm={confirm.handleConfirm}
        onCancel={confirm.handleCancel}
      />
    </main>
  );
}

describe("Dialog and Modal", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("does not add a generic fallback name", () => {
    render(
      <Dialog isOpen={true} onClose={() => {}}>
        <div>Content</div>
      </Dialog>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBeNull();
    expect(dialog.getAttribute("aria-labelledby")).toBeNull();
  });

  test("uses explicit aria-label as accessible name", () => {
    render(
      <Dialog isOpen={true} onClose={() => {}} ariaLabel="Delete task">
        <div>Content</div>
      </Dialog>
    );
    const dialog = screen.getByRole("dialog", { name: "Delete task" });
    expect(dialog.getAttribute("aria-label")).toBe("Delete task");
  });

  test("does not add fallback if aria-labelledby is provided", () => {
    render(
      <Dialog isOpen={true} onClose={() => {}} ariaLabelledBy="title-id">
        <h1 id="title-id">Title</h1>
      </Dialog>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBeNull();
    expect(dialog.getAttribute("aria-labelledby")).toBe("title-id");
  });

  test("omits aria-describedby when not provided", () => {
    render(
      <Dialog isOpen={true} onClose={() => {}}>
        <div>Content</div>
      </Dialog>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.hasAttribute("aria-describedby")).toBe(false);
  });

  test("restores focus to the trigger after an action closes it", async () => {
    render(<DialogHarness />);

    const trigger = screen.getByRole("button", { name: "Open dialog" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "Close dialog" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  test("falls back to the page when the trigger unmounts before close", async () => {
    render(<DialogHarness unmountTrigger />);

    const trigger = screen.getByRole("button", { name: "Open dialog" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "Close dialog" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId("page-fallback"));
    });
  });

  test("uses reduced-motion state transitions without delayed CSS motion", async () => {
    setReducedMotion(true);
    const { rerender } = render(
      <Dialog isOpen={true} onClose={() => {}} ariaLabel="Reduced dialog">
        <div>Content</div>
      </Dialog>
    );

    expect(screen.getByRole("dialog", { name: "Reduced dialog" }).style.transition).toBe("none");

    rerender(
      <Dialog isOpen={false} onClose={() => {}} ariaLabel="Reduced dialog">
        <div>Content</div>
      </Dialog>
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Reduced dialog" })).toBeNull();
    });
  });

  test("dropdown keyboard navigation skips disabled items and Escape restores focus", async () => {
    function MenuHarness() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <DropdownMenu
          isOpen={isOpen}
          onOpenChange={setIsOpen}
          menuAriaLabel="Task actions"
          content={
            <div>
              <DropdownMenuItem disabled>Disabled action</DropdownMenuItem>
              <button type="button" role="menuitem" aria-disabled="true">
                Aria disabled action
              </button>
              <DropdownMenuItem>First enabled</DropdownMenuItem>
              <DropdownMenuItem>Last enabled</DropdownMenuItem>
            </div>
          }
        >
          <button type="button">Open actions</button>
        </DropdownMenu>
      );
    }

    render(<MenuHarness />);

    const trigger = screen.getByRole("button", { name: "Open actions" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    await screen.findByRole("menu", { name: "Task actions" });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "First enabled" }));
    });

    fireEvent.keyDown(document, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Last enabled" }));

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "First enabled" }));

    const escapeEvent = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(escapeEvent);

    expect(escapeEvent.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  test("confirm dialog exposes a stable name, focuses cancel first, and resolves true only from the confirm button", async () => {
    const onDecision = vi.fn();
    render(<ConfirmHarness onDecision={onDecision} />);

    const trigger = screen.getByRole("button", { name: "Open confirm" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "Reset runtime state" });
    expect(dialog).toHaveAttribute("aria-describedby", "confirm-dialog-body");
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep" }));
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(onDecision).toHaveBeenCalledWith(true);
      expect(document.activeElement).toBe(trigger);
    });
  });

  test("confirm dialog resolves false on cancel, Escape, and backdrop dismissal without confirming", async () => {
    const onDecision = vi.fn();
    render(<ConfirmHarness onDecision={onDecision} />);

    const trigger = screen.getByRole("button", { name: "Open confirm" });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "Keep" }));
    await waitFor(() => expect(onDecision).toHaveBeenLastCalledWith(false));

    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "Reset runtime state" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onDecision).toHaveBeenCalledTimes(2));
    expect(onDecision).toHaveBeenLastCalledWith(false);

    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Reset runtime state" });
    const backdrop = dialog.parentElement?.firstElementChild as HTMLElement | undefined;
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    await waitFor(() => expect(onDecision).toHaveBeenCalledTimes(3));
    expect(onDecision).toHaveBeenLastCalledWith(false);
  });
});
