/** @vitest-environment happy-dom */
import { h } from "preact";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, expect, test, describe, vi } from "vitest";
import { AddProjectModal } from "../AddProjectModal.js";
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

describe("AddProjectModal Accessibility", () => {
  afterEach(() => {
    cleanup();
  });

  const revealImportedSetupOptions = async () => {
    render(<AddProjectModal onClose={() => {}} onAdd={() => {}} initialSourceType="local" />);

    const nameInput = screen.getByLabelText(/Project Name/i);
    fireEvent.input(nameInput, { target: { value: "Imported App" } });
    fireEvent.submit(nameInput.closest("form")!);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Techstack/i })).toBeInTheDocument();
    });
  };

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

  test("invalid git submit marks errors, focuses first invalid field, and scrolls form body", async () => {
    render(<AddProjectModal onClose={() => {}} onAdd={() => {}} initialSourceType="local" />);

    fireEvent.click(screen.getByRole("button", { name: /git url/i }));

    const form = document.getElementById("add-project-form") as HTMLFormElement;
    const formBody = document.getElementById("add-project-form-body") as HTMLDivElement;
    const scrollTo = vi.fn();
    Object.defineProperty(formBody, "scrollTo", { value: scrollTo, configurable: true });

    fireEvent.submit(form);

    await waitFor(() => {
      const nameInput = document.getElementById("add-project-name") as HTMLInputElement;
      const pathInput = document.getElementById("add-project-git-url") as HTMLInputElement;
      expect(nameInput).toHaveAttribute("aria-invalid", "true");
      expect(pathInput).toHaveAttribute("aria-invalid", "true");
      expect(document.activeElement).toBe(nameInput);
      expect(scrollTo).toHaveBeenCalled();
    });

    const nameInput = document.getElementById("add-project-name") as HTMLInputElement;
    const pathInput = document.getElementById("add-project-git-url") as HTMLInputElement;
    expect(nameInput).toHaveAttribute("aria-errormessage", "project-name-error");
    expect(pathInput).toHaveAttribute("aria-describedby", "project-git-error");
  });

  test("imported setup exposes a default-enabled keyboard-focusable techstack option", async () => {
    await revealImportedSetupOptions();

    const techstackOption = screen.getByRole("button", { name: /Techstack/i });
    expect(techstackOption).toHaveAttribute("aria-pressed", "true");

    techstackOption.focus();
    expect(document.activeElement).toBe(techstackOption);
  });

  test("new project setup omits the techstack detection option", () => {
    render(<AddProjectModal onClose={() => {}} onAdd={() => {}} initialSourceType="new_project" />);

    expect(screen.queryByRole("button", { name: /Techstack/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Initialize with Project Setup Agent/i)).not.toBeInTheDocument();
  });
});
