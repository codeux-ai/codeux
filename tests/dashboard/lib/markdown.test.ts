import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../../dashboard/src/lib/markdown.js";

describe("renderMarkdown", () => {
  it("renders markdown formatting", () => {
    const rendered = renderMarkdown("**hello**");
    expect(rendered).toContain("<strong>hello</strong>");
  });

  it("drops inline html blocks", () => {
    const rendered = renderMarkdown("before <script>alert(1)</script> after");
    expect(rendered).not.toContain("<script>");
    expect(rendered).toContain("before ");
    expect(rendered).toContain(" after");
  });
});
