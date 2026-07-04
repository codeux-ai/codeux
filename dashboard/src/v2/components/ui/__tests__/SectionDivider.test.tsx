/**
 * @vitest-environment jsdom
 */

import { render } from "@testing-library/preact";
import { SectionDivider } from "../SectionDivider";
import { SectionHeader } from "../SectionHeader";
import { describe, it, expect } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import React from "preact/compat";

expect.extend(matchers);

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

  it("keeps SectionHeader on shared hairline and metadata surface language", () => {
    const { container, getByText } = render(<SectionHeader watermark="DATA" title="Projects" icon={<span aria-hidden="true">I</span>} />);

    const header = container.firstChild as HTMLElement;
    expect(header).not.toBeNull();
    expect(header).toHaveClass("border-[color:var(--border-hairline)]");
    expect(header).toHaveClass("pb-4");

    const watermark = getByText("DATA");
    expect(watermark).toHaveClass("text-[color:var(--fill-muted-hover)]");
    expect(watermark).toHaveClass("motion-reduce:transform-none");

    const title = getByText("Projects");
    expect(title).toHaveClass("text-[color:var(--text-primary)]");
  });
});
