// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationCredentialMetadata } from "../../../../../../src/contracts/automation-credential-types.js";
import { AutomationCredentialManager } from "../AutomationCredentialManager.js";
import {
  createAutomationCredential,
  fetchAutomationCredentials,
  fetchCredentialHealth,
  promoteAutomationCredential,
  replaceAutomationCredential,
  restrictAutomationCredential,
  revokeAutomationCredential,
  rotateAutomationCredential,
  testAutomationCredential,
  updateAutomationCredential,
} from "../../../lib/automation-credential-api.js";

vi.mock("../../../lib/automation-credential-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/automation-credential-api.js")>();
  return {
    ...actual,
    fetchAutomationCredentials: vi.fn(),
    fetchCredentialHealth: vi.fn(),
    createAutomationCredential: vi.fn(),
    updateAutomationCredential: vi.fn(),
    testAutomationCredential: vi.fn(),
    rotateAutomationCredential: vi.fn(),
    replaceAutomationCredential: vi.fn(),
    restrictAutomationCredential: vi.fn(),
    promoteAutomationCredential: vi.fn(),
    revokeAutomationCredential: vi.fn(),
  };
});
const credential = (overrides: Partial<AutomationCredentialMetadata> = {}): AutomationCredentialMetadata => ({
  id: "credential-1",
  name: "Deployment token",
  kind: "api-token",
  scope: "project",
  projectId: "project-1",
  managementProjectId: "project-1",
  allowedProjectIds: [],
  capabilities: ["read", "write"],
  status: "active",
  configured: true,
  keyId: "root",
  keyVersion: 1,
  version: 1,
  lastValidatedAt: null,
  validationStatus: "untested",
  createdAt: "now",
  updatedAt: "now",
  ...overrides,
});

const readyHealth = {
  available: true,
  secure: true,
  provider: "local-file",
  keyId: "root",
  keyVersion: 1,
};

const renderManager = () => render(
  <AutomationCredentialManager
    projectId="project-1"
    projects={[
      { id: "project-1", name: "Selected project" },
      { id: "project-2", name: "Allowed project" },
    ]}
  />,
);

describe("AutomationCredentialManager", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchAutomationCredentials).mockResolvedValue([credential()]);
    vi.mocked(fetchCredentialHealth).mockResolvedValue(readyHealth);
  });

  it("renders unavailable health safely and disables secret writes", async () => {
    vi.mocked(fetchCredentialHealth).mockResolvedValue({
      available: false,
      secure: true,
      provider: "mounted-key-file",
      keyId: null,
      keyVersion: null,
      reason: "No mounted credential key file is configured.",
    });

    renderManager();

    expect(await screen.findByText("Deployment token")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("No mounted credential key file is configured.");
    expect(screen.getByRole("alert").textContent).toContain("Restore the configured secure key provider");
    expect((screen.getByRole("button", { name: "Store credential" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Test" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Rotate" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Replace" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Promote credential" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Revoke" }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).not.toContain("plain-secret");
    expect(document.body.textContent).not.toContain("root");
  });

  it("shows ready-unconfigured state, requires explicit capabilities, and clears create secrets after every outcome", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchAutomationCredentials).mockResolvedValue([]);
    vi.mocked(createAutomationCredential).mockResolvedValue(credential());
    renderManager();

    expect(await screen.findByText(/Ready, not configured/)).toBeTruthy();
    await user.type(screen.getByLabelText("Credential name"), "Deploy token");
    await user.type(screen.getByLabelText("Credential kind"), "api-token");
    const secretInput = screen.getByLabelText("Secret value") as HTMLInputElement;
    await user.type(secretInput, "plain-secret");
    await user.click(screen.getByRole("button", { name: "Store credential" }));

    expect(await screen.findByText("Select at least one capability deliberately.")).toBeTruthy();
    expect(secretInput.value).toBe("");
    expect(createAutomationCredential).not.toHaveBeenCalled();

    await user.type(secretInput, "next-secret");
    await user.click(screen.getByRole("checkbox", { name: /^Read/ }));
    await user.click(screen.getByRole("button", { name: "Store credential" }));

    await waitFor(() => expect(createAutomationCredential).toHaveBeenCalledWith("project-1", {
      name: "Deploy token",
      kind: "api-token",
      value: "next-secret",
      scope: "project",
      allowedProjectIds: [],
      capabilities: ["read"],
    }));
    expect(secretInput.value).toBe("");
    expect(document.body.textContent).not.toContain("next-secret");
  });

  it("renames and tests with current versions and typed inline success", async () => {
    const user = userEvent.setup();
    vi.mocked(updateAutomationCredential).mockResolvedValue(credential({ name: "Release token", version: 2 }));
    vi.mocked(testAutomationCredential).mockResolvedValue(credential({ name: "Release token", version: 3, validationStatus: "valid" }));
    renderManager();

    const renameInput = await screen.findByLabelText("Rename Deployment token");
    await user.clear(renameInput);
    await user.type(renameInput, "Release token");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(updateAutomationCredential).toHaveBeenCalledWith("project-1", "credential-1", {
      name: "Release token",
      expectedVersion: 1,
    }));
    expect(await screen.findByText("Credential name updated.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(testAutomationCredential).toHaveBeenCalledWith("project-1", "credential-1", { expectedVersion: 2 }));
    expect(await screen.findByText("Credential test passed.")).toBeTruthy();
  });

  it("guards rotation with confirmation, clears the write-only field, and restores trigger focus", async () => {
    const user = userEvent.setup();
    vi.mocked(rotateAutomationCredential).mockResolvedValue(credential({ version: 2 }));
    renderManager();

    const secretInput = await screen.findByLabelText("New secret for Deployment token") as HTMLInputElement;
    await user.type(secretInput, "rotated-secret");
    const rotateButton = screen.getByRole("button", { name: "Rotate" });
    rotateButton.focus();
    await user.click(rotateButton);
    expect(rotateAutomationCredential).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Rotate Deployment token?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Rotate value" }));

    await waitFor(() => expect(rotateAutomationCredential).toHaveBeenCalledWith("project-1", "credential-1", {
      value: "rotated-secret",
      expectedVersion: 1,
    }));
    expect(secretInput.value).toBe("");
    const item = rotateButton.closest("li") as HTMLElement;
    await waitFor(() => expect(item.contains(document.activeElement)).toBe(true));
  });

  it("confirms monotonic restriction, promotion, and revocation before lifecycle calls", async () => {
    const user = userEvent.setup();
    vi.mocked(restrictAutomationCredential).mockResolvedValue(credential({ capabilities: ["read"], version: 2 }));
    vi.mocked(promoteAutomationCredential).mockResolvedValue(credential({
      scope: "global",
      projectId: null,
      allowedProjectIds: ["project-1", "project-2"],
      capabilities: ["read"],
      version: 3,
    }));
    vi.mocked(revokeAutomationCredential).mockResolvedValue(credential({
      scope: "global",
      projectId: null,
      allowedProjectIds: ["project-1", "project-2"],
      capabilities: ["read"],
      status: "revoked",
      version: 4,
    }));
    renderManager();

    const item = (await screen.findByText("Deployment token")).closest("li") as HTMLElement;
    const restrictionFieldset = within(item).getByText("Restrict capabilities").closest("fieldset") as HTMLElement;
    await user.click(within(restrictionFieldset).getByRole("checkbox", { name: /^Write/ }));
    await user.click(within(item).getByRole("button", { name: "Apply restriction" }));
    expect(restrictAutomationCredential).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("dialog", { name: "Restrict Deployment token?" })).getByRole("button", { name: "Apply restriction" }));
    await waitFor(() => expect(restrictAutomationCredential).toHaveBeenCalledWith("project-1", "credential-1", {
      expectedVersion: 1,
      capabilities: ["read"],
      allowedProjectIds: [],
    }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const promotionFieldset = within(item).getByText("Promote to global access").closest("fieldset") as HTMLElement;
    await user.click(within(promotionFieldset).getByRole("checkbox", { name: /Allowed project/ }));
    await user.click(within(item).getByRole("button", { name: "Promote credential" }));
    expect(promoteAutomationCredential).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("dialog", { name: "Promote Deployment token to global access?" })).getByRole("button", { name: "Promote credential" }));
    await waitFor(() => expect(promoteAutomationCredential).toHaveBeenCalledWith("project-1", "credential-1", {
      expectedVersion: 2,
      allowedProjectIds: ["project-1", "project-2"],
      confirmScopeExpansion: true,
    }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const revokeTrigger = within(item).getByRole("button", { name: "Revoke" });
    revokeTrigger.focus();
    await user.click(revokeTrigger);
    expect(revokeAutomationCredential).not.toHaveBeenCalled();
    const revokeDialog = await screen.findByRole("dialog", { name: "Revoke Deployment token?" });
    const confirmationInput = within(revokeDialog).getByLabelText("Type REVOKE to confirm");
    const guardedRevokeButton = within(revokeDialog).getByRole("button", { name: "Type REVOKE to enable Revoke credential" });
    expect((guardedRevokeButton as HTMLButtonElement).disabled).toBe(true);

    await user.type(confirmationInput, "REVOK");
    expect((guardedRevokeButton as HTMLButtonElement).disabled).toBe(true);
    expect(revokeAutomationCredential).not.toHaveBeenCalled();
    await user.type(confirmationInput, "E");
    await user.click(within(revokeDialog).getByRole("button", { name: "Revoke credential" }));
    await waitFor(() => expect(revokeAutomationCredential).toHaveBeenCalledWith("project-1", "credential-1", { expectedVersion: 3 }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByLabelText("Type REVOKE to confirm")).toBeNull();
    expect(await screen.findByText("Credential revoked.")).toBeTruthy();
    await waitFor(() => expect(item.contains(document.activeElement)).toBe(true));
  });

  it("prevents management from an allowlisted non-owner project", async () => {
    vi.mocked(fetchAutomationCredentials).mockResolvedValue([credential({
      scope: "global",
      projectId: null,
      managementProjectId: "project-2",
      allowedProjectIds: ["project-1", "project-2"],
    })]);
    renderManager();

    expect(await screen.findByText("Use only")).toBeTruthy();
    expect(screen.getByText(/managed by another project/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save name" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Test" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("clears a replacement secret when the API rejects a stale version", async () => {
    const user = userEvent.setup();
    vi.mocked(replaceAutomationCredential).mockRejectedValue(new Error("Credential changed; refresh its metadata and retry with the current version."));
    renderManager();

    const secretInput = await screen.findByLabelText("New secret for Deployment token") as HTMLInputElement;
    await user.type(secretInput, "replacement-secret");
    await user.click(screen.getByRole("button", { name: "Replace" }));
    await user.click(screen.getByRole("button", { name: "Replace value" }));

    expect(await screen.findByText(/changed in another session/)).toBeTruthy();
    expect(secretInput.value).toBe("");
  });
});
