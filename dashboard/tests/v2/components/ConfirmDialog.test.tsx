/** @jsx h */
// @vitest-environment jsdom
import { h } from "preact";
import { render, screen, fireEvent } from "@testing-library/preact";
import { describe, it, expect, vi } from "vitest";
import { ConfirmDialog } from "../../../src/v2/components/ui/ConfirmDialog.js";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

describe("ConfirmDialog", () => {
  const defaultOptions = {
    title: "Delete Project?",
    body: "This action cannot be undone.",
    confirmLabel: "Delete",
    cancelLabel: "Cancel",
    destructive: true,
  };

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

  it("calls onConfirm when confirm button is clicked", () => {
    const handleConfirm = vi.fn();
    render(
      <ConfirmDialog isOpen={true} options={defaultOptions} onConfirm={handleConfirm} onCancel={vi.fn()} />
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
    fireEvent.keyDown(document, { key: "Escape" });
    expect(handleCancel).toHaveBeenCalledTimes(1);
  });
});
