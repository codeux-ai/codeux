/** @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom" />
import { h } from "preact";
import { cleanup, fireEvent, render as baseRender, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SkillStorageContentsResponse } from "../../../src/contracts/skill-types.js";
import type { SkillStorageRecord } from "../../../dashboard/src/v2/types.js";
import { fetchSkillStorageContents } from "../../../dashboard/src/v2/lib/agent-preset-api.js";
import { PersistentSkillStorageChip } from "../../../dashboard/src/v2/components/agents/PersistentSkillStorageChip.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/index.js";

const render: typeof baseRender = (ui, options) => baseRender(ui, {
  ...options,
  wrapper: ({ children }) => (
    <DashboardI18nProvider initialLocale="en" storage={null}>
      {children}
    </DashboardI18nProvider>
  ),
});

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    killTweensOf: vi.fn(),
    to: vi.fn().mockImplementation((_, config) => config?.onComplete?.()),
    fromTo: vi.fn().mockImplementation((_, __, config) => config?.onComplete?.()),
    context: vi.fn().mockImplementation(() => ({
      add: (callback: () => void) => callback(),
      revert: vi.fn(),
    })),
  },
}));

vi.mock("../../../dashboard/src/v2/lib/agent-preset-api.js", () => ({
  fetchSkillStorageContents: vi.fn(),
}));

const storage: SkillStorageRecord = {
  id: "storage-shared",
  projectId: "project-test",
  name: "Shared delivery patterns with an intentionally long storage name for narrow screens",
  description: "Reusable delivery guidance.",
  storageKind: "project",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const makeContents = (count: number, truncated = false): SkillStorageContentsResponse => ({
  storage,
  truncated,
  skills: Array.from({ length: count }, (_, index) => ({
    id: `skill-${index + 1}`,
    name: `Skill ${index + 1}`,
    description: `Summary ${index + 1}`,
    tags: index === 0 ? ["planning", "delivery", "quality", "hidden-tag"] : [],
    appliesTo: [],
    version: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    contentPreview: index === 0 ? "x".repeat(220) : `Short preview ${index + 1}`,
  })),
});

describe("PersistentSkillStorageChip", () => {
  afterEach(() => {
    cleanup();
    vi.mocked(fetchSkillStorageContents).mockReset();
    vi.clearAllMocks();
  });

  it("loads only on first pointer hover and renders a bounded summary disclosure", async () => {
    let resolveContents: ((contents: SkillStorageContentsResponse) => void) | undefined;
    vi.mocked(fetchSkillStorageContents).mockImplementation(() => new Promise((resolve) => {
      resolveContents = resolve;
    }));
    render(<PersistentSkillStorageChip storage={storage} />);

    const chip = screen.getByRole("button", { name: `Inspect attached skill storage ${storage.name}` });
    expect(chip).toHaveAttribute("title", storage.name);
    expect(fetchSkillStorageContents).not.toHaveBeenCalled();

    fireEvent.pointerEnter(chip, { pointerType: "mouse" });

    expect(await screen.findByText("Loading storage contents…")).toBeInTheDocument();
    resolveContents?.(makeContents(6, true));
    await screen.findByText("Skill 1");
    expect(fetchSkillStorageContents).toHaveBeenCalledTimes(1);
    expect(fetchSkillStorageContents).toHaveBeenCalledWith("project-test", "storage-shared");
    expect(screen.getByText("6+ skills")).toBeInTheDocument();
    expect(screen.getByText("Preview truncated")).toBeInTheDocument();
    expect(screen.getByText("+1 tag")).toBeInTheDocument();
    expect(screen.getByText("2 more loaded skills hidden from this preview.")).toBeInTheDocument();
    expect(screen.getByText("More skills are available beyond this bounded response.")).toBeInTheDocument();
    expect(screen.queryByText("Skill 5")).not.toBeInTheDocument();

    fireEvent.pointerLeave(chip, { pointerType: "mouse" });
    fireEvent.pointerEnter(chip, { pointerType: "mouse" });
    await waitFor(() => expect(fetchSkillStorageContents).toHaveBeenCalledTimes(1));
  });

  it("exposes the equivalent empty disclosure from keyboard focus", async () => {
    vi.mocked(fetchSkillStorageContents).mockImplementation(async () => makeContents(0));
    render(<PersistentSkillStorageChip storage={storage} />);

    fireEvent.focus(screen.getByRole("button", { name: `Inspect attached skill storage ${storage.name}` }));

    expect(await screen.findByText("No skills saved in this storage.")).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("0 skills");
    expect(fetchSkillStorageContents).toHaveBeenCalledTimes(1);
  });

  it("shows a retryable error without exposing content bodies", async () => {
    let attempt = 0;
    vi.mocked(fetchSkillStorageContents).mockImplementation(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("offline");
      return makeContents(1);
    });
    render(<PersistentSkillStorageChip storage={storage} />);

    const chip = screen.getByRole("button", { name: `Inspect attached skill storage ${storage.name}` });
    fireEvent.focus(chip);
    expect(await screen.findByText("Couldn’t load storage contents")).toBeInTheDocument();
    expect(screen.getByText(/press Enter while it is focused, to retry/)).toBeInTheDocument();

    fireEvent.click(chip);

    expect(await screen.findByText("Skill 1")).toBeInTheDocument();
    expect(fetchSkillStorageContents).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/contentMarkdown/i)).not.toBeInTheDocument();
  });

  it("keeps detached storages readable without fetching their contents", () => {
    render(<PersistentSkillStorageChip storage={storage} attached={false} />);

    const detachedChip = screen.getByTitle(storage.name);
    fireEvent.pointerEnter(detachedChip, { pointerType: "mouse" });
    expect(detachedChip).toHaveTextContent(storage.name);
    expect(fetchSkillStorageContents).not.toHaveBeenCalled();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
