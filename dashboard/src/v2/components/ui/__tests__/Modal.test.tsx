// @vitest-environment jsdom
import { h } from "preact";
import { render, screen, cleanup } from "@testing-library/preact";
import { Modal } from "../Modal.js";
import { expect, test, describe, afterEach } from "vitest";

describe("Modal", () => {
  afterEach(() => {
    cleanup();
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
});
