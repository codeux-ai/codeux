/**
 * @vitest-environment jsdom
 */

import { render } from "@testing-library/preact";
import { SectionDivider } from "../SectionDivider";
import { describe, it, expect } from "vitest";
import React from "preact/compat";

describe("SectionDivider", () => {
  it("renders with correct label and classes", () => {
    const { container } = render(<SectionDivider label="Test Streams" className="py-6" />);

    const divider = container.firstChild as HTMLElement;
    expect(divider).not.toBeNull();
    expect(divider.className).toContain("w-full");
    expect(divider.className).toContain("py-6");

    // Ensure the label text renders.
    expect(container.textContent).toBe("Test Streams");
  });

  it("applies default padding class when className is not provided", () => {
    const { container } = render(<SectionDivider label="Default Padding Divider" />);

    const divider = container.firstChild as HTMLElement;
    expect(divider).not.toBeNull();
    expect(divider.className).toContain("py-2");
    expect(divider.className).toContain("md:py-4");
  });
});
