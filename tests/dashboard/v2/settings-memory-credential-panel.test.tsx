/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { useState } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../dashboard/src/lib/settings.js";
import { SettingsMemoryPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsMemoryPanel.js";

const credentialApi = vi.hoisted(() => ({
  fetchAutomationCredentials: vi.fn(),
  fetchCredentialHealth: vi.fn(),
  bindAutomationCredential: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/lib/automation-credential-api.js", () => ({
  ...credentialApi,
  createAutomationCredential: vi.fn(),
  testAutomationCredential: vi.fn(),
  rotateAutomationCredential: vi.fn(),
  replaceAutomationCredential: vi.fn(),
  revokeAutomationCredential: vi.fn(),
}));
vi.mock("../../../dashboard/src/v2/lib/scheduler-api.js", () => ({
  fetchMemoryRemediationSchedule: vi.fn().mockResolvedValue({ cadence: "off", mode: "deterministic", entry: null }),
  saveMemoryRemediationSchedule: vi.fn(),
}));

describe("SettingsMemoryPanel credential binding", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    credentialApi.fetchAutomationCredentials.mockResolvedValue([{
      id: "embedding-credential",
      name: "Embedding provider",
      kind: "api-token",
      scope: "project",
      projectId: "project-1",
      managementProjectId: "project-1",
      allowedProjectIds: [],
      capabilities: ["read"],
      status: "active",
      configured: true,
      keyId: "root",
      keyVersion: 1,
      version: 2,
      lastValidatedAt: null,
      validationStatus: "valid",
      createdAt: "now",
      updatedAt: "now",
    }]);
    credentialApi.fetchCredentialHealth.mockResolvedValue({ available: true, secure: true, provider: "test", keyId: "root", keyVersion: 1 });
    credentialApi.bindAutomationCredential.mockResolvedValue({});
  });

  it("binds a project override and keeps legacy secret text out of rendered output", async () => {
    const Harness = () => {
      const [settings, setSettings] = useState({
        ...DEFAULT_DASHBOARD_SETTINGS,
        memory: {
          ...DEFAULT_DASHBOARD_SETTINGS.memory,
          embeddingProvider: "external_api" as const,
          externalEmbedding: {
            ...DEFAULT_DASHBOARD_SETTINGS.memory.externalEmbedding,
            apiKey: "sentinel-embedding-secret",
          },
        },
      });
      return <SettingsMemoryPanel state={{
        activeScope: "project",
        editableSettings: settings,
        selectedProject: { id: "project-1", name: "Test project" },
        projectSources: { "memory.externalEmbedding.apiKeyCredentialRef": "system" },
        updateEditableSettings: (recipe: (current: typeof settings) => typeof settings) => setSettings((current) => recipe(current)),
      } as any} />;
    };

    render(<Harness />);
    expect(document.body.textContent).not.toContain("sentinel-embedding-secret");
    await userEvent.click(await screen.findByLabelText("Embedding API credential"));
    await userEvent.click(await screen.findByRole("option", { name: /Embedding provider.*active.*v2/ }));
    await userEvent.click(screen.getByRole("button", { name: "Bind" }));

    await waitFor(() => expect(credentialApi.bindAutomationCredential).toHaveBeenCalledWith(
      "project-1",
      "embedding-credential",
      { bindingKey: "settings:embedding.external", capabilities: ["read"] },
    ));
    expect(screen.getByRole("button", { name: "Embedding API credential" })).toHaveTextContent("Embedding provider");
    expect(document.body.textContent).not.toContain("sentinel-embedding-secret");
  });

  it("preserves the local embedding path without showing external credential controls", () => {
    render(<SettingsMemoryPanel state={{
      activeScope: "system",
      editableSettings: DEFAULT_DASHBOARD_SETTINGS,
      selectedProject: null,
      projectSources: {},
      updateEditableSettings: vi.fn(),
    } as any} />);

    expect(screen.getByRole("combobox", { name: "Embedding backend" })).toHaveValue("in_app");
    expect(screen.queryByLabelText("Embedding API credential")).not.toBeInTheDocument();
  });
});
