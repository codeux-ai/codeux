import { describe, expect, it } from "vitest";
import { resolveDocsWebHref } from "../../dashboard/src/v2/docs-web/docs-web-links.js";
import { docIdFromPath } from "../../dashboard/src/v2/docs-web/DocsWebPage.js";
import type { DocsWebEntry } from "../../src/contracts/docs-web-types.js";

const docs = [
  {
    id: "user-dashboard-overview",
    path: "/docs/user-dashboard-overview",
    sourcePath: "user/dashboard/overview.md",
    section: "User Guide",
    title: "Dashboard",
    description: "Dashboard overview",
  },
  {
    id: "developer-mcp-tools",
    path: "/docs/developer-mcp-tools",
    sourcePath: "developer/mcp-tools.md",
    section: "Developer Reference",
    title: "MCP tools",
    description: "Tool contracts",
  },
] satisfies DocsWebEntry[];

describe("resolveDocsWebHref", () => {
  it("rewrites relative markdown links to app docs routes", () => {
    expect(resolveDocsWebHref("./dashboard/overview.md#projects", "user/index.md", docs)).toBe("/docs/user-dashboard-overview#projects");
    expect(resolveDocsWebHref("../../developer/mcp-tools.md", "user/dashboard/overview.md", docs)).toBe("/docs/developer-mcp-tools");
  });

  it("leaves non-doc and absolute links unchanged", () => {
    expect(resolveDocsWebHref("https://example.com", "user/index.md", docs)).toBe("https://example.com");
    expect(resolveDocsWebHref("#local", "user/index.md", docs)).toBe("#local");
    expect(resolveDocsWebHref("/api/docs-web", "user/index.md", docs)).toBe("/api/docs-web");
    expect(resolveDocsWebHref("./image.png", "user/index.md", docs)).toBe("./image.png");
  });
});

describe("docIdFromPath", () => {
  it("maps legacy settings docs URLs to the current docs document", () => {
    expect(docIdFromPath("/docs/user/dashboard/settings")).toBe("user-dashboard-settings");
    expect(docIdFromPath("/docs/user/dashboard/settings/")).toBe("user-dashboard-settings");
  });
});
