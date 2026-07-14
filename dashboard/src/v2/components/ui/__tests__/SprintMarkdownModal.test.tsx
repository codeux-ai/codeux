/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardI18nProvider } from "../../../i18n/context.js";
import { SprintMarkdownModal } from "../SprintMarkdownModal.js";

describe("SprintMarkdownModal", () => {
  afterEach(cleanup);

  it("round-trips authored Markdown unchanged through German import chrome", async () => {
    const sprintMarkdown = "name: Überprüfung\ngoal:\nKeep `POST /v2/jobs` unchanged & exact.";
    const tasksMarkdown = "--- FILE: T01.md ---\ntitle: Prüfe API\nprompt:\nRun `pnpm test` -- genau so.";
    const onImport = vi.fn().mockResolvedValue(undefined);

    render(
      <DashboardI18nProvider initialLocale="de" storage={null}>
        <SprintMarkdownModal
          mode="import"
          sprintMarkdown={sprintMarkdown}
          tasksMarkdown={tasksMarkdown}
          onClose={vi.fn()}
          onImport={onImport}
        />
      </DashboardI18nProvider>,
    );

    expect(screen.getByText("Sprint-Markdown importieren.")).toBeInTheDocument();
    const editors = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    expect(editors[0]).toHaveValue(sprintMarkdown);
    expect(editors[1]).toHaveValue(tasksMarkdown);

    fireEvent.click(screen.getByRole("button", { name: "Sprint importieren" }));

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport).toHaveBeenCalledWith({ sprintMarkdown, tasksMarkdown });
  });
});
