/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { useState } from "preact/hooks";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomDashboardEditorPanel, type CustomDashboardDraftState, type CustomDashboardEditorTab } from "../CustomDashboardEditorPanel.js";
import { stableJsonStringify } from "../../../lib/custom-dashboard-view-models.js";

const longContent = `export default function Dashboard() { return <pre>${"x".repeat(4_000)}</pre>; }`;
const initialDraft: CustomDashboardDraftState = {
  title: "Delivery Pulse",
  description: "Release health",
  manifestText: stableJsonStringify({ schemaVersion: 1, title: "Delivery Pulse", entryFile: "src/dashboard.tsx", filePaths: ["src/dashboard.tsx"] }),
  fileBundleText: stableJsonStringify({ files: [{ path: "src/dashboard.tsx", contentType: "text/typescript-jsx", content: longContent }] }),
  sourceGraphText: stableJsonStringify({ nodes: [{ id: "incidents", type: "external_api", title: "Incidents", credentialSlots: [{ slot: "token", label: "Incident token", required: true, allowedKinds: ["api-token"], requiredCapability: "read" }] }], edges: [] }),
  routesText: stableJsonStringify([{ path: "/", label: "Overview", entryFile: "src/dashboard.tsx" }]),
  credentialBindingsText: "[]",
  styleguideText: "{}",
};

const credential = {
  id: "credential-1", name: "Incident credential", kind: "api-token", scope: "project" as const,
  projectId: "project-1", managementProjectId: "project-1", allowedProjectIds: ["project-1"], capabilities: ["read"],
  status: "active" as const, configured: true, keyId: "key", keyVersion: 1, version: 2,
  lastValidatedAt: null, validationStatus: "valid" as const, createdAt: "now", updatedAt: "now",
};

const Harness = () => {
  const [draft, setDraft] = useState(initialDraft);
  const [tab, setTab] = useState<CustomDashboardEditorTab>("manifest");
  return <div><CustomDashboardEditorPanel draft={draft} onDraftChange={setDraft} activeTab={tab} onActiveTabChange={setTab} selectedFilePath="src/dashboard.tsx" onSelectedFilePathChange={vi.fn()} catalog={null} credentials={[credential]} onRotateCredential={vi.fn()} onRevokeCredential={vi.fn()} /><output data-testid="draft">{draft.credentialBindingsText}</output></div>;
};

describe("CustomDashboardEditorPanel", () => {
  afterEach(cleanup);

  it("offers typed route, source, file, credential, and advanced controls without rendering secrets", async () => {
    render(<Harness />);
    expect(screen.getByRole("tab", { name: "Routes" })).toHaveAttribute("aria-selected", "false");
    fireEvent.click(screen.getByRole("tab", { name: "Files" }));
    expect(screen.getByLabelText("Selected file content")).toHaveValue(longContent);
    expect(screen.getByLabelText("Selected file content type")).toHaveValue("text/typescript-jsx");

    fireEvent.click(screen.getByRole("tab", { name: "Credentials" }));
    expect(screen.queryByText(/must-not-render|secret value/i)).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Incident token credential"), "credential-1");
    expect(screen.getByTestId("draft")).toHaveTextContent("credential-1");
    expect(screen.getByLabelText("Incident credential new secret value")).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("tab", { name: "Advanced JSON" }));
    expect(screen.getByLabelText("Credential bindings JSON (IDs only)")).toBeInTheDocument();
  });
});
