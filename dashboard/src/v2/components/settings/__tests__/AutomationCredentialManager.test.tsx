// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationCredentialMetadata } from "../../../../../../src/contracts/automation-credential-types.js";
import { AutomationCredentialManager, CredentialReferenceSelector } from "../AutomationCredentialManager.js";
import {
  bindAutomationCredential,
  createAutomationCredential,
  fetchAutomationCredentials,
  fetchCredentialHealth,
  revokeAutomationCredential,
  rotateAutomationCredential,
} from "../../../lib/automation-credential-api.js";

vi.mock("../../../lib/automation-credential-api.js", () => ({
  fetchAutomationCredentials: vi.fn(),
  fetchCredentialHealth: vi.fn(),
  createAutomationCredential: vi.fn(),
  bindAutomationCredential: vi.fn(),
  testAutomationCredential: vi.fn(),
  rotateAutomationCredential: vi.fn(),
  replaceAutomationCredential: vi.fn(),
  revokeAutomationCredential: vi.fn(),
}));

const credential = (overrides: Partial<AutomationCredentialMetadata> = {}): AutomationCredentialMetadata => ({
  id: "credential-1",
  name: "Deployment token",
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
  version: 1,
  lastValidatedAt: null,
  validationStatus: "untested",
  createdAt: "now",
  updatedAt: "now",
  ...overrides,
});

const availableHealth = { available: true, secure: true, provider: "test-vault", keyId: "root", keyVersion: 1 } as const;

describe("AutomationCredentialManager", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchAutomationCredentials).mockResolvedValue([credential()]);
    vi.mocked(fetchCredentialHealth).mockResolvedValue(availableHealth);
    vi.mocked(createAutomationCredential).mockResolvedValue(credential());
    vi.mocked(rotateAutomationCredential).mockResolvedValue(credential({ version: 2 }));
    vi.mocked(revokeAutomationCredential).mockResolvedValue(credential({ status: "revoked" }));
    vi.mocked(bindAutomationCredential).mockResolvedValue({ id: "binding-1", credentialId: "credential-1", projectId: "project-1", bindingKey: "settings:test", requiredCapabilities: ["read"], createdAt: "now", updatedAt: "now" });
  });

  it("renders metadata and disables secret writes when secure storage is unavailable", async () => {
    vi.mocked(fetchAutomationCredentials).mockResolvedValue([{ ...credential(), value: "plain-secret" } as AutomationCredentialMetadata]);
    vi.mocked(fetchCredentialHealth).mockResolvedValue({ available: false, secure: false, provider: "electron-safe-storage", keyId: null, keyVersion: null, reason: "OS secure storage is unavailable." });
    render(<AutomationCredentialManager projectId="project-1" />);
    expect(await screen.findByText("Deployment token")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("OS secure storage is unavailable.");
    expect((screen.getByRole("button", { name: "Store credential" }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).not.toContain("plain-secret");
  });

  it("validates capabilities and clears a write-only value after creation", async () => {
    const user = userEvent.setup();
    render(<AutomationCredentialManager projectId="project-1" />);
    await screen.findByText("Deployment token");
    await user.type(screen.getByLabelText("Credential name"), "Build token");
    await user.type(screen.getByLabelText("Credential kind"), "api-token");
    await user.type(screen.getByLabelText("Credential secret value"), "write-only-secret");
    await user.click(screen.getByRole("checkbox", { name: "read" }));
    expect(screen.getByRole("alert").textContent).toContain("Select at least one capability");
    await user.click(screen.getByRole("checkbox", { name: "read" }));
    await user.click(screen.getByRole("button", { name: "Store credential" }));
    await waitFor(() => expect(createAutomationCredential).toHaveBeenCalledWith("project-1", expect.objectContaining({ value: "write-only-secret", scope: "project", capabilities: ["read"] })));
    await waitFor(() => expect(screen.getByLabelText("Credential secret value")).toHaveValue(""));
    expect(document.body.textContent).not.toContain("write-only-secret");
  });

  it("binds a metadata selection with keyboard activation", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CredentialReferenceSelector projectId="project-1" bindingKey="settings:test" label="Test token" onChange={onChange} />);
    await waitFor(() => expect(fetchAutomationCredentials).toHaveBeenCalledWith("project-1"));
    await user.click(screen.getByLabelText("Test token credential"));
    await user.click(await screen.findByText(/Deployment token · api-token/));
    const bindButton = screen.getByRole("button", { name: "Bind" });
    bindButton.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(bindAutomationCredential).toHaveBeenCalledWith("project-1", "credential-1", { bindingKey: "settings:test", capabilities: ["read"] }));
    expect(onChange).toHaveBeenCalledWith({ credentialId: "credential-1", capability: "read" });
  });

  it("rotates a credential and clears the replacement input", async () => {
    const user = userEvent.setup();
    render(<AutomationCredentialManager projectId="project-1" />);
    const input = await screen.findByLabelText("Deployment token new secret value");
    await user.type(input, "rotated-secret");
    await user.click(screen.getByRole("button", { name: "Rotate" }));
    await waitFor(() => expect(rotateAutomationCredential).toHaveBeenCalledWith("project-1", "credential-1", "rotated-secret"));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(document.body.textContent).not.toContain("rotated-secret");
  });

  it("requires confirmation before revocation", async () => {
    const user = userEvent.setup();
    render(<AutomationCredentialManager projectId="project-1" />);
    await screen.findByText("Deployment token");
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    expect(revokeAutomationCredential).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm revoke" }));
    await waitFor(() => expect(revokeAutomationCredential).toHaveBeenCalledWith("project-1", "credential-1"));
  });
});
