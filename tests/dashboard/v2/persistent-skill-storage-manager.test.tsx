/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { PersistentSkillStorageManager } from "../../../dashboard/src/v2/components/settings/PersistentSkillStorageManager.js";
import {
  createSkillStorage,
  deleteSkillStorage,
  fetchSkillStorageContents,
  fetchSkillStorages,
  updateSkillStorage,
} from "../../../dashboard/src/v2/lib/agent-preset-api.js";
import type { SkillStorageRecord } from "../../../src/contracts/skill-types.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/lib/agent-preset-api.js", () => ({
  createSkillStorage: vi.fn(),
  deleteSkillStorage: vi.fn(),
  fetchSkillStorageContents: vi.fn(),
  fetchSkillStorages: vi.fn(),
  updateSkillStorage: vi.fn(),
}));

const project = { id: "project-storage", name: "Test Project" };
const storage: SkillStorageRecord = {
  id: "storage-one",
  projectId: project.id,
  name: "Review Skills",
  description: "Durable review guidance",
  storageKind: "project",
  createdAt: "2026-07-09T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
};

const contents = {
  storage,
  skills: [{
    id: "skill-one",
    name: "Review safely",
    description: "Inspect before editing",
    tags: ["review"],
    appliesTo: ["src/**"],
    version: "1.0.0",
    updatedAt: "2026-07-10T00:00:00.000Z",
    contentPreview: "Read adjacent code first.",
  }],
  truncated: false,
};

const openManager = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "Manage storages" }));
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchSkillStorages).mockResolvedValue([storage]);
  vi.mocked(fetchSkillStorageContents).mockResolvedValue(contents);
  vi.mocked(createSkillStorage).mockResolvedValue(storage);
  vi.mocked(updateSkillStorage).mockResolvedValue(storage);
  vi.mocked(deleteSkillStorage).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PersistentSkillStorageManager", () => {
  it("opens from a project-only summary and communicates the unavailable state", async () => {
    render(<PersistentSkillStorageManager project={null} storages={[]} onStoragesChange={vi.fn()} />);

    expect(screen.getByText("Project storage unavailable")).toBeInTheDocument();
    openManager();

    expect(await screen.findByRole("dialog", { name: "Persistent skill storage" })).toBeInTheDocument();
    expect(screen.getByText("Select a project first")).toBeInTheDocument();
    expect(screen.getByText(/storages are owned by one project/i)).toBeInTheDocument();
    expect(fetchSkillStorages).not.toHaveBeenCalled();
  });

  it("shows loading, empty, and load-failure states in an announced region", async () => {
    let resolveList: ((value: SkillStorageRecord[]) => void) | undefined;
    vi.mocked(fetchSkillStorages).mockImplementationOnce(() => new Promise((resolve) => { resolveList = resolve; }));
    render(<PersistentSkillStorageManager project={project} storages={[]} onStoragesChange={vi.fn()} />);
    openManager();

    expect(await screen.findByText("Loading storages…")).toBeInTheDocument();
    resolveList?.([]);
    expect(await screen.findByText("No project storages yet")).toBeInTheDocument();

    cleanup();
    vi.mocked(fetchSkillStorages).mockRejectedValueOnce(new Error("Storage service unavailable"));
    render(<PersistentSkillStorageManager project={project} storages={[]} onStoragesChange={vi.fn()} />);
    openManager();

    expect(await screen.findByRole("alert")).toHaveTextContent("Storage service unavailable");
  });

  it("creates records immediately, blocks duplicate mutations, and reports success", async () => {
    let resolveCreate: ((value: SkillStorageRecord) => void) | undefined;
    vi.mocked(fetchSkillStorages).mockResolvedValueOnce([]);
    vi.mocked(createSkillStorage).mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve; }));
    const onStoragesChange = vi.fn();
    render(<PersistentSkillStorageManager project={project} storages={[]} onStoragesChange={onStoragesChange} />);
    openManager();
    await screen.findByText("No project storages yet");

    fireEvent.input(screen.getByLabelText("Storage name"), { target: { value: " Review Skills " } });
    fireEvent.input(screen.getByLabelText("Description"), { target: { value: " Durable review guidance " } });
    fireEvent.click(screen.getByRole("button", { name: "Create storage" }));

    expect(createSkillStorage).toHaveBeenCalledWith(project.id, {
      name: "Review Skills",
      description: "Durable review guidance",
      storageKind: "project",
    });
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close persistent skill storage manager" })).toBeDisabled();
    resolveCreate?.(storage);

    expect(await screen.findByText("Review Skills was created for Test Project.")).toBeInTheDocument();
    expect(onStoragesChange).toHaveBeenLastCalledWith([storage]);
  });

  it("edits with updateSkillStorage and supports cancelling an edit", async () => {
    vi.mocked(fetchSkillStorages).mockResolvedValueOnce([storage]);
    vi.mocked(updateSkillStorage).mockResolvedValueOnce({ ...storage, name: "Updated Review", description: "Updated notes" });
    render(<PersistentSkillStorageManager project={project} storages={[storage]} onStoragesChange={vi.fn()} />);
    openManager();
    await screen.findByText("1 skill available");

    fireEvent.click(screen.getByRole("button", { name: "Edit Review Skills" }));
    fireEvent.input(screen.getAllByLabelText("Storage name")[1], { target: { value: "Discarded name" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
    expect(updateSkillStorage).not.toHaveBeenCalled();
    expect(screen.getByText("Review Skills")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit Review Skills" }));
    fireEvent.input(screen.getAllByLabelText("Storage name")[1], { target: { value: " Updated Review " } });
    fireEvent.input(screen.getAllByLabelText("Description")[1], { target: { value: " Updated notes " } });
    fireEvent.click(screen.getByRole("button", { name: "Save storage" }));

    await waitFor(() => expect(updateSkillStorage).toHaveBeenCalledWith(project.id, storage.id, {
      name: "Updated Review",
      description: "Updated notes",
    }));
    expect(await screen.findByText("Updated Review was updated.")).toBeInTheDocument();
  });

  it("requires the target name before deletion and restores focus when cancelled", async () => {
    vi.mocked(fetchSkillStorages).mockResolvedValueOnce([storage]);
    render(<PersistentSkillStorageManager project={project} storages={[storage]} onStoragesChange={vi.fn()} />);
    openManager();
    await screen.findByText("1 skill available");

    const deleteButton = screen.getByRole("button", { name: "Delete Review Skills" });
    fireEvent.click(deleteButton);
    const confirmButton = screen.getByRole("button", { name: "Type Review Skills to enable Delete storage" });
    expect(confirmButton).toBeDisabled();
    fireEvent.input(screen.getByLabelText("Type Review Skills to confirm"), { target: { value: "Wrong name" } });
    expect(confirmButton).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Keep storage" }));
    await waitFor(() => expect(deleteButton).toHaveFocus());
    expect(deleteSkillStorage).not.toHaveBeenCalled();

    fireEvent.click(deleteButton);
    fireEvent.input(screen.getByLabelText("Type Review Skills to confirm"), { target: { value: "Review Skills" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete storage" }));

    await waitFor(() => expect(deleteSkillStorage).toHaveBeenCalledWith(project.id, storage.id));
    expect(await screen.findByText("Review Skills was deleted.")).toBeInTheDocument();
    expect(screen.getByText("No project storages yet")).toBeInTheDocument();
  });
});
