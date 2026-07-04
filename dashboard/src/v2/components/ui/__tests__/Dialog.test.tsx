// @vitest-environment jsdom
import { h } from "preact";
import { render, screen, cleanup } from "@testing-library/preact";
import { Dialog } from "../Dialog.js";
import { expect, test, describe, afterEach } from "vitest";

describe("Dialog and Modal", () => {
  afterEach(() => {
    cleanup();
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
});
