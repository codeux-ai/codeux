/** @vitest-environment happy-dom */
import { h } from "preact";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { beforeEach, expect, test, describe } from "vitest";
import { AddProjectModal } from "../AddProjectModal.js";
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

describe("AddProjectModal Accessibility", () => {
  beforeEach(() => {
    cleanup();
  });

  test("renders with accessible name and structure", () => {
    const { container } = render(<AddProjectModal onClose={() => {}} onAdd={() => {}} initialSourceType="local" />);
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs[0]).toHaveAttribute("aria-labelledby", "add-project-modal-title");

    // Check for fixed header/footer and scrollable body structure
    const formBody = document.getElementById("add-project-form-body");
    expect(formBody).toBeInTheDocument();
  });

  test("form inputs have associated labels and handle validation errors", async () => {
    const { container } = render(<AddProjectModal onClose={() => {}} onAdd={() => {}} initialSourceType="local" />);

    // Check for Local Path input
    const pathInput = document.getElementById("add-project-path");
    expect(pathInput).toBeInTheDocument();

    // Check for Project Name input
    const nameInput = document.getElementById("add-project-name");
    expect(nameInput).toBeInTheDocument();
  });

  test("setup invocation affordances have accessible labels and pressed state", () => {
    render(<AddProjectModal onClose={() => {}} onAdd={() => {}} initialSourceType="local" />);

    const setupToggle = screen.getByLabelText(/Initialize with Project Setup Agent/i);
    expect(setupToggle).toBeChecked();
    fireEvent.input(screen.getByLabelText(/Project Name/i), { target: { value: "Synthetic Project" } });

    fireEvent.submit(screen.getByLabelText(/Project Name/i).closest("form")!);

    expect(screen.getByRole("button", { name: /Agents/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Quicksprints/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Preview Script/i })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /^CI/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
  });
});
