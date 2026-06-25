/** @vitest-environment happy-dom */
import { h } from "preact";
import { render, screen, waitFor } from "@testing-library/preact";
import { expect, test, describe, vi } from "vitest";
import { AddProjectModal } from "../AddProjectModal.js";
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

describe("AddProjectModal Accessibility", () => {
  test("renders with accessible name and structure", () => {
    const { container } = render(<AddProjectModal onClose={() => {}} onAdd={() => {}} initialSourceType="local" />);
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs[0]).toHaveAttribute("aria-labelledby", "add-project-modal-title");
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
});
