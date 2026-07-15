/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import type { ComponentChildren } from "preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocsWebSidebar } from "../../../dashboard/src/v2/docs-web/DocsWebSidebar.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/context.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: { children: ComponentChildren; to: string }) => <a href={to} {...props}>{children}</a>,
}));

const englishDoc = {
  id: "getting-started",
  path: "/docs/getting-started",
  sourcePath: "docs/getting-started.md",
  section: "Getting Started" as const,
  title: "Getting Started with Code UX",
  description: "English documentation description",
};

describe("DocsWebSidebar i18n", () => {
  afterEach(cleanup);

  it("translates viewer controls while leaving fetched documentation metadata in English", () => {
    render(
      <DashboardI18nProvider initialLocale="de">
        <DocsWebSidebar
          currentDocId={englishDoc.id}
          collection={{
            defaultDocId: englishDoc.id,
            docs: [englishDoc],
            groupedDocs: { "Getting Started": [englishDoc], "User Guide": [], "Developer Reference": [], Architecture: [] },
          }}
        />
      </DashboardI18nProvider>,
    );

    expect(screen.getByLabelText("Dokumentationsnavigation")).toBeInTheDocument();
    expect(screen.getByText("Getting Started")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Getting Started with Code UX" })).toBeInTheDocument();
    fireEvent.input(screen.getByPlaceholderText("Dokumentation durchsuchen"), { target: { value: "Code UX" } });
    expect(screen.getByText("1 Ergebnis")).toBeInTheDocument();
  });
});
