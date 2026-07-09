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

  it("drops iframe html blocks", () => {
    const rendered = renderMarkdown("before <iframe src=\"https://example.com\"></iframe> after");
    expect(rendered).not.toContain("<iframe");
    expect(rendered).not.toContain("src=");
    expect(rendered).toContain("before ");
    expect(rendered).toContain(" after");
  });

  it("strips javascript URLs in links", () => {
    const rendered = renderMarkdown("[unsafe](javascript:alert(1))");
    expect(rendered).not.toContain("href");
    expect(rendered).toContain("unsafe");
  });

  it("strips mixed-case and entity-obfuscated javascript URLs in links", () => {
    const rendered1 = renderMarkdown("[unsafe](JaVaScRiPt:alert(1))");
    expect(rendered1).not.toContain("href");
    expect(rendered1).toContain("unsafe");

    const rendered2 = renderMarkdown("[unsafe](java&#x73;cript&#58;alert(1))");
    expect(rendered2).not.toContain("href");
    expect(rendered2).toContain("unsafe");
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

  it("strips newline-obfuscated javascript URLs", () => {
    const rendered = renderMarkdown("[unsafe](java\nscript:alert(1))");
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

  it("preserves anchors and query-only links", () => {
    const rendered1 = renderMarkdown("[safe](#section)");
    expect(rendered1).toContain('href="#section"');

    const rendered2 = renderMarkdown("[safe](?panel=settings)");
    expect(rendered2).toContain('href="?panel=settings"');
  });

  it("adds rel=noopener noreferrer to external links", () => {
    const rendered = renderMarkdown("[external](https://example.com)");
    expect(rendered).toContain('href="https://example.com/"');
    expect(rendered).toContain('rel="noopener noreferrer"');
    expect(rendered).not.toContain('target="_blank"');
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

  it("strips SVG data image URLs", () => {
    const rendered = renderMarkdown("![unsafe](data:image/svg+xml,<svg onload=alert(1)>)");
    expect(rendered).not.toContain("<img");
    expect(rendered).not.toContain("src=");
    expect(rendered).toContain("unsafe");
  });

  it("strips obfuscated javascript URLs in links", () => {
    const rendered = renderMarkdown("[unsafe](java\\nscript:alert(1))");
    expect(rendered).not.toContain("href");
    expect(rendered).toContain("unsafe");
  });

  it("strips protocol-relative URLs", () => {
    const rendered1 = renderMarkdown("[unsafe](//google.com)");
    expect(rendered1).not.toContain("href");
    const rendered2 = renderMarkdown("[unsafe](\\\\\\google.com)");
    expect(rendered2).not.toContain("href");
    const rendered3 = renderMarkdown("![unsafe](//google.com/image.png)");
    expect(rendered3).not.toContain("src");
  });

  it("strips mailto in images", () => {
    const rendered = renderMarkdown("![unsafe](mailto:test@test.com)");
    expect(rendered).not.toContain("img");
    expect(rendered).not.toContain("src");
    expect(rendered).toContain("unsafe");
  });

  it("preserves relative links containing colons", () => {
    const rendered1 = renderMarkdown("[safe](search?q=foo:bar)");
    expect(rendered1).toContain('href="search?q=foo:bar"');
    const rendered2 = renderMarkdown("[safe](page.html?time=12:30)");
    expect(rendered2).toContain('href="page.html?time=12:30"');
    const rendered3 = renderMarkdown("[safe](doc#section:1)");
    expect(rendered3).toContain('href="doc#section:1"');
  });

  it("strips raw HTML tags", () => {
    const rendered = renderMarkdown("plain <script>alert(1)</script> text <iframe src='http://bad'></iframe>");
    expect(rendered).not.toContain("<script>");
    expect(rendered).not.toContain("<iframe>");
    expect(rendered).toContain("plain ");
    expect(rendered).toContain(" text ");
  });

  it("adds rel=noopener noreferrer to http external links", () => {
    const rendered = renderMarkdown("[external](http://example.com)");
    expect(rendered).toContain('href="http://example.com/"');
    expect(rendered).toContain('rel="noopener noreferrer"');
  });

  it("preserves normal relative markdown links without slashes", () => {
    const rendered = renderMarkdown("[internal](page.html)");
    expect(rendered).toContain('href="page.html"');
    expect(rendered).not.toContain('rel="noopener noreferrer"');
  });

  it("strips malformed absolute URLs and scheme-smuggled relatives", () => {
    const rendered1 = renderMarkdown("[unsafe](https://[::1)");
    expect(rendered1).not.toContain("href");

    const rendered2 = renderMarkdown("[unsafe](javascript:alert(1)/safe)");
    expect(rendered2).not.toContain("href");
  });

  it("escapes rendered attribute values", () => {
    const rendered = renderMarkdown("[safe](https://example.com/?q=%22x%22 \"quote & <tag>\")");
    expect(rendered).toContain('href="https://example.com/?q=%22x%22"');
    expect(rendered).toContain('title="quote &amp; &lt;tag&gt;"');

    const image = renderMarkdown("![safe & <image>](https://example.com/image.png \"quote & <tag>\")");
    expect(image).toContain('alt="safe &amp; &lt;image&gt;"');
    expect(image).toContain('title="quote &amp; &lt;tag&gt;"');
  });

  it("revalidates transformed link URLs", () => {
    const rendered = renderMarkdown("[safe](https://example.com)", {
      transformHref: () => "javascript:alert(1)",
    });
    expect(rendered).not.toContain("href");
    expect(rendered).toContain("safe");
  });

  it("revalidates and escapes transformed image URLs", () => {
    const unsafe = renderMarkdown("![safe](https://example.com/image.png)", {
      transformHref: () => "data:image/svg+xml,<svg onload=alert(1)>",
    });
    expect(unsafe).not.toContain("<img");

    const safe = renderMarkdown("![safe](https://example.com/image.png)", {
      transformHref: () => "https://cdn.example.com/image.png?name=%22safe%22",
    });
    expect(safe).toContain('src="https://cdn.example.com/image.png?name=%22safe%22"');
  });
});
