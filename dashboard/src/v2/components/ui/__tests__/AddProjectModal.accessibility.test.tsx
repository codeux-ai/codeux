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
});
