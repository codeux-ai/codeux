/**
 * @vitest-environment jsdom
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { h } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { SectionCard } from "../../../dashboard/src/v2/components/settings/panels/SharedPanelComponents.js";
import { SETTINGS_SUBCATEGORY_DOCS } from "../../../dashboard/src/v2/lib/settings-subcategory-docs.js";

afterEach(() => {
  cleanup();
});

describe("settings subcategory help", () => {
  it("renders card-level info and docs controls with subcategory-specific accessible names", () => {
    render(
      <SectionCard title="Default Routing Anchors" icon={<span aria-hidden>R</span>}>
        <p>Routing settings</p>
      </SectionCard>,
    );

    expect(screen.getByRole("button", { name: "Show help for Default Routing Anchors" })).toBeInTheDocument();
    const docsLink = screen.getByRole("link", { name: "Open documentation for Default Routing Anchors" });

    expect(docsLink).toHaveAttribute("href", "/docs/settings-default-routing-anchors");
  });

  it("supports explicit help metadata for dynamic subcategory titles", () => {
    render(
      <SectionCard title="Playwright" helpId="custom-mcp-server" icon={<span aria-hidden>M</span>}>
        <p>MCP server settings</p>
      </SectionCard>,
    );

    expect(screen.getByRole("button", { name: "Show help for Playwright" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open documentation for Playwright" })).toHaveAttribute(
      "href",
      "/docs/settings-custom-mcp-server",
    );
  });

  it("has canonical docs files for every subcategory metadata entry", () => {
    const docsRoot = path.resolve(process.cwd(), "docs/settings");
    const docsWebRoot = path.resolve(process.cwd(), "docs-web/settings");

    for (const doc of Object.values(SETTINGS_SUBCATEGORY_DOCS)) {
      expect(existsSync(path.join(docsRoot, `${doc.id}.md`)), `${doc.id} should have canonical docs`).toBe(true);
      expect(existsSync(path.join(docsWebRoot, `${doc.id}.md`)), `${doc.id} should have docs-web docs`).toBe(true);
      expect(doc.docsHref).toMatch(/^\/docs\/settings-[a-z0-9-]+$/u);
    }
  });
});
