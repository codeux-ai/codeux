/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardI18nProvider, useDashboardI18n } from "../../../dashboard/src/v2/i18n/context.js";
import { chatMessages } from "../../../dashboard/src/v2/i18n/messages/chat.js";
import { projectMessages } from "../../../dashboard/src/v2/i18n/messages/projects.js";
import { shellMessages } from "../../../dashboard/src/v2/i18n/messages/shell.js";

const runtimeFixture = {
  providerMessage: "Provider says: Authentication failed for model opus-latest.",
  projectName: "English Customer Portal",
  sprintName: "Keep this Sprint Title in English",
  taskTitle: "Do not translate user-authored task content",
  chatMarkdown: "## English user message\n\nRun `pnpm test` and preserve **API output**.",
  docsMarkdown: "# System overview\n\nThe runtime coordinates provider CLIs.",
} as const;

function RuntimeBoundaryHarness() {
  const { formatDate, formatNumber, translate } = useDashboardI18n();
  return (
    <main aria-label={translate(shellMessages, "workspace")}>
      <h1>{translate(projectMessages, "manageProjects")}</h1>
      <section aria-label={translate(chatMessages, "messages")}>
        <p>{runtimeFixture.providerMessage}</p>
        <p>{runtimeFixture.projectName}</p>
        <p>{runtimeFixture.sprintName}</p>
        <p>{runtimeFixture.taskTitle}</p>
        <pre>{runtimeFixture.chatMarkdown}</pre>
        <article>{runtimeFixture.docsMarkdown}</article>
      </section>
      <output aria-label="localized-number">{formatNumber(1234.5)}</output>
      <time>{formatDate(Date.UTC(2026, 6, 14), { timeZone: "UTC" })}</time>
    </main>
  );
}

describe("dashboard i18n runtime and authored-content boundary", () => {
  afterEach(cleanup);

  it("translates dashboard chrome and formatting without rewriting server, docs, or user content", () => {
    render(
      <DashboardI18nProvider initialLocale="de" storage={null}>
        <RuntimeBoundaryHarness />
      </DashboardI18nProvider>,
    );

    expect(screen.getByRole("main", { name: "Arbeitsbereich" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Projekte verwalten" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Nachrichten" })).toBeInTheDocument();
    for (const value of Object.values(runtimeFixture)) {
      expect(document.body.textContent).toContain(value);
    }
    expect(screen.getByLabelText("localized-number")).toHaveTextContent(
      new Intl.NumberFormat("de").format(1234.5),
    );
    expect(screen.getByText(new Intl.DateTimeFormat("de", { timeZone: "UTC" }).format(Date.UTC(2026, 6, 14))))
      .toBeInTheDocument();
  });
});
