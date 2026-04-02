/** @vitest-environment jsdom */
import * as React from "preact/compat";
import { h } from "preact";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/preact";
import { afterEach } from "vitest";
import { ConfirmationDialog } from "../../../dashboard/src/v2/components/ui/ConfirmationDialog.js";
import { ActionFeedbackRegion } from "../../../dashboard/src/v2/components/ui/ActionFeedbackRegion.js";
import { useActionFeedback } from "../../../dashboard/src/v2/hooks/use-action-feedback.js";

afterEach(() => {
    cleanup();
});

vi.mock("gsap", () => {
    return {
        default: {
            to: (target: any, options: any) => {
                if (options && options.onComplete) {
                    options.onComplete();
                }
                return {};
            },
            fromTo: () => ({})
        }
    };
});

describe("ConfirmationDialog", () => {
    vi.useFakeTimers();

    it("renders when isOpen is true and shows correct text", () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();

        render(
            <ConfirmationDialog
                isOpen={true}
                title="Delete item?"
                message="Are you sure you want to delete this item?"
                confirmText="Yes, delete"
                cancelText="No, keep it"
                variant="destructive"
                onConfirm={onConfirm}
                onCancel={onCancel}
            />
        );

        expect(screen.getByRole("dialog")).toBeDefined();
        expect(screen.getByText("Delete item?")).toBeDefined();
        expect(screen.getByText("Are you sure you want to delete this item?")).toBeDefined();
        expect(screen.getByText("Yes, delete")).toBeDefined();
        expect(screen.getByText("No, keep it")).toBeDefined();
    });

    it("does not render when isOpen is false", () => {
        const { container } = render(
            <ConfirmationDialog
                isOpen={false}
                title="Delete item?"
                message="Are you sure you want to delete this item?"
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            />
        );
        expect(container.firstChild).toBeNull();
    });

    it("calls onConfirm when confirm button is clicked", () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();

        render(
            <ConfirmationDialog
                isOpen={true}
                title="Confirm Title"
                message="Please confirm"
                onConfirm={onConfirm}
                onCancel={onCancel}
            />
        );

        fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
        expect(onConfirm).toHaveBeenCalled();
        expect(onCancel).not.toHaveBeenCalled();
    });

    it("calls onCancel when cancel button is clicked", () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();

        render(
            <ConfirmationDialog
                isOpen={true}
                title="Confirm Title"
                message="Please confirm"
                onConfirm={onConfirm}
                onCancel={onCancel}
            />
        );

        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(onCancel).toHaveBeenCalled();
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it("handles Escape key to cancel", () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();

        render(
            <ConfirmationDialog
                isOpen={true}
                title="Confirm Title"
                message="Please confirm"
                onConfirm={onConfirm}
                onCancel={onCancel}
            />
        );

        fireEvent.keyDown(document, { key: "Escape" });
        expect(onCancel).toHaveBeenCalled();
        expect(onConfirm).not.toHaveBeenCalled();
    });
});

describe("ActionFeedbackRegion and useActionFeedback", () => {
    const TestComponent = () => {
        const { feedback, setFeedback, clearFeedback } = useActionFeedback();
        return (
            <div>
                <button onClick={() => setFeedback("pending", "Saving...")}>Set Pending</button>
                <button onClick={() => setFeedback("success", "Saved!")}>Set Success</button>
                <button onClick={() => clearFeedback()}>Clear</button>
                <div data-testid="status">{feedback.status}</div>
                <div data-testid="message">{feedback.message}</div>
                <ActionFeedbackRegion feedback={feedback} onDismiss={clearFeedback} />
            </div>
        );
    };

    it("hook initializes with idle state", () => {
        render(<TestComponent />);
        expect(screen.getByTestId("status").textContent).toBe("idle");
        expect(screen.getByTestId("message").textContent).toBe("");
    });

    it("hook updates state via setFeedback", () => {
        render(<TestComponent />);
        fireEvent.click(screen.getByText("Set Pending"));
        expect(screen.getByTestId("status").textContent).toBe("pending");
        expect(screen.getByTestId("message").textContent).toBe("Saving...");
    });

    it("hook clears state via clearFeedback", () => {
        render(<TestComponent />);
        fireEvent.click(screen.getByText("Set Success"));
        fireEvent.click(screen.getByText("Clear"));
        expect(screen.getByTestId("status").textContent).toBe("idle");
        expect(screen.getByTestId("message").textContent).toBe("");
    });

    it("does not render when status is idle", () => {
        const { container } = render(
            <ActionFeedbackRegion feedback={{ status: "idle", message: "" }} onDismiss={vi.fn()} />
        );
        expect(container.firstChild).toBeNull();
    });

    it("renders correctly for success state", () => {
        render(
            <ActionFeedbackRegion feedback={{ status: "success", message: "Successfully updated." }} onDismiss={vi.fn()} />
        );
        const region = screen.getByRole("status");
        expect(region).toBeDefined();
        expect(region.getAttribute("aria-live")).toBe("polite");
        expect(screen.getByText("Successfully updated.")).toBeDefined();
    });

    it("renders correctly for error state", () => {
        render(
            <ActionFeedbackRegion feedback={{ status: "error", message: "Failed to update." }} onDismiss={vi.fn()} />
        );
        const region = screen.getByRole("alert");
        expect(region).toBeDefined();
        expect(region.getAttribute("aria-live")).toBe("assertive");
        expect(screen.getByText("Failed to update.")).toBeDefined();
    });

    it("calls onDismiss when close button is clicked", () => {
        const onDismiss = vi.fn();
        render(
            <ActionFeedbackRegion feedback={{ status: "success", message: "Success!" }} onDismiss={onDismiss} />
        );
        fireEvent.click(screen.getByLabelText("Dismiss feedback"));
        expect(onDismiss).toHaveBeenCalled();
    });

    it("does not show close button when pending", () => {
        render(
            <ActionFeedbackRegion feedback={{ status: "pending", message: "Loading..." }} onDismiss={vi.fn()} />
        );
        expect(screen.getByText("Loading...")).toBeDefined();
        expect(screen.queryByLabelText("Dismiss feedback")).toBeNull();
    });
});
