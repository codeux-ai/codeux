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

  it("strips javascript URLs in links", () => {
    const rendered = renderMarkdown("[unsafe](javascript:alert(1))");
    expect(rendered).not.toContain("href");
    expect(rendered).toContain("unsafe");
  });

  it("strips data URLs in links", () => {
    const rendered = renderMarkdown("[unsafe](data:text/html,<script>alert(1)</script>)");
    expect(rendered).not.toContain("href");
    expect(rendered).toContain("unsafe");
  });

  it("strips vbscript URLs in links", () => {
    const rendered = renderMarkdown("[unsafe](vbscript:msgbox(1))");
    expect(rendered).not.toContain("href");
    expect(rendered).toContain("unsafe");
  });

  it("strips javascript URLs with spaces/encoded characters", () => {
    const rendered = renderMarkdown("[unsafe]( javascript:alert(1))");
    expect(rendered).not.toContain("href");
    expect(rendered).toContain("unsafe");
  });

  it("preserves relative links", () => {
    const rendered = renderMarkdown("[safe](/path/to/page)");
    expect(rendered).toContain('href="/path/to/page"');
    expect(rendered).toContain("safe");
  });

  it("preserves mailto links", () => {
    const rendered = renderMarkdown("[safe](mailto:test@example.com)");
    expect(rendered).toContain('href="mailto:test@example.com"');
  });

  it("adds rel=noopener noreferrer to external links", () => {
    const rendered = renderMarkdown("[external](https://example.com)");
    expect(rendered).toContain('href="https://example.com"');
    expect(rendered).toContain('rel="noopener noreferrer"');
  });

  it("does not add rel=noopener noreferrer to relative links", () => {
    const rendered = renderMarkdown("[internal](/docs)");
    expect(rendered).toContain('href="/docs"');
    expect(rendered).not.toContain('rel="noopener noreferrer"');
  });

  it("strips unsafe image URLs", () => {
    const rendered = renderMarkdown("![unsafe image](javascript:alert(1))");
    expect(rendered).not.toContain("img");
    expect(rendered).not.toContain("src");
    expect(rendered).toContain("unsafe image");
  });

  it("preserves safe image URLs", () => {
    const rendered = renderMarkdown("![safe image](https://example.com/image.png)");
    expect(rendered).toContain('<img src="https://example.com/image.png" alt="safe image">');
  });
});
