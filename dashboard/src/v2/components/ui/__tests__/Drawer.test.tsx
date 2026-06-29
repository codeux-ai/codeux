// @vitest-environment jsdom
import { h } from "preact";
import { render, screen, cleanup } from "@testing-library/preact";
import { Drawer } from "../Drawer.js";
import { expect, test, describe, afterEach } from "vitest";

describe("Drawer", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders with fallback accessible name 'Drawer'", () => {
    render(
      <Drawer isOpen={true} onClose={() => {}}>
        <div>Content</div>
      </Drawer>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Drawer");
  });

  test("renders with provided ariaLabel", () => {
    render(
      <Drawer isOpen={true} onClose={() => {}} ariaLabel="Sprint settings">
        <div>Content</div>
      </Drawer>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Sprint settings");
  });

  test("does not add fallback if aria-labelledby is provided", () => {
    render(
      <Drawer isOpen={true} onClose={() => {}} ariaLabelledBy="title-id">
        <h1 id="title-id">Title</h1>
      </Drawer>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBeNull();
    expect(dialog.getAttribute("aria-labelledby")).toBe("title-id");
  });

  test("omits aria-describedby when not provided", () => {
    render(
      <Drawer isOpen={true} onClose={() => {}}>
        <div>Content</div>
      </Drawer>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.hasAttribute("aria-describedby")).toBe(false);
  });
});
