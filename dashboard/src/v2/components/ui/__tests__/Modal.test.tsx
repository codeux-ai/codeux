// @vitest-environment jsdom
import { h } from "preact";
import { render, screen, cleanup } from "@testing-library/preact";
import { Modal } from "../Modal.js";
import { expect, test, describe, afterEach } from "vitest";

describe("Modal", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders with accessible name", () => {
    render(
      <Modal isOpen={true} onClose={() => {}}>
        <div>Content</div>
      </Modal>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Dialog");
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
});
