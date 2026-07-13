import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "../../../lib/api/fetch-json.js";
import {
  AutomationCredentialApiError,
  createAutomationCredential,
  promoteAutomationCredential,
  replaceAutomationCredential,
  restrictAutomationCredential,
  revokeAutomationCredential,
  rotateAutomationCredential,
  testAutomationCredential,
  updateAutomationCredential,
} from "../automation-credential-api.js";

vi.mock("../../../lib/api/fetch-json.js", () => ({ fetchJson: vi.fn() }));

describe("automation credential api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchJson).mockResolvedValue({});
  });

  it("uses encoded write-only create, rotate, and replace endpoints", async () => {
    const createInput = {
      name: "Token",
      kind: "api-token",
      value: "secret",
      scope: "project" as const,
      allowedProjectIds: [],
      capabilities: ["read"],
    };
    await createAutomationCredential("project/one", createInput);
    expect(fetchJson).toHaveBeenCalledWith("/api/projects/project%2Fone/credentials", expect.objectContaining({
      method: "POST",
      body: JSON.stringify(createInput),
    }));

    await rotateAutomationCredential("project/one", "credential/one", { value: "next", expectedVersion: 1 });
    expect(fetchJson).toHaveBeenLastCalledWith("/api/projects/project%2Fone/credentials/credential%2Fone/rotate", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ value: "next", expectedVersion: 1 }),
    }));

    await replaceAutomationCredential("project/one", "credential/one", { value: "replacement", expectedVersion: 2 });
    expect(fetchJson).toHaveBeenLastCalledWith("/api/projects/project%2Fone/credentials/credential%2Fone/replace", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ value: "replacement", expectedVersion: 2 }),
    }));
  });

  it("passes current versions and backend policy fields to every metadata lifecycle endpoint", async () => {
    await updateAutomationCredential("project", "credential", { name: "Renamed", expectedVersion: 3 });
    expect(fetchJson).toHaveBeenLastCalledWith("/api/projects/project/credentials/credential", expect.objectContaining({ method: "PATCH" }));

    await testAutomationCredential("project", "credential", { expectedVersion: 4 });
    expect(fetchJson).toHaveBeenLastCalledWith("/api/projects/project/credentials/credential/test", expect.objectContaining({ body: JSON.stringify({ expectedVersion: 4 }) }));

    const restriction = { allowedProjectIds: ["project"], capabilities: ["read"], expectedVersion: 5 };
    await restrictAutomationCredential("project", "credential", restriction);
    expect(fetchJson).toHaveBeenLastCalledWith("/api/projects/project/credentials/credential/restrict", expect.objectContaining({ body: JSON.stringify(restriction) }));

    const promotion = { allowedProjectIds: ["project", "other"], expectedVersion: 6, confirmScopeExpansion: true };
    await promoteAutomationCredential("project", "credential", promotion);
    expect(fetchJson).toHaveBeenLastCalledWith("/api/projects/project/credentials/credential/promote", expect.objectContaining({ body: JSON.stringify(promotion) }));

    await revokeAutomationCredential("project", "credential", { expectedVersion: 7 });
    expect(fetchJson).toHaveBeenLastCalledWith("/api/projects/project/credentials/credential/revoke", expect.objectContaining({ body: JSON.stringify({ expectedVersion: 7 }) }));
  });

  it("converts raw server failures into typed, non-raw stale and custody guidance", async () => {
    vi.mocked(fetchJson).mockRejectedValueOnce(new Error("Credential changed; refresh its metadata and retry with the current version."));
    await expect(testAutomationCredential("project", "credential", { expectedVersion: 1 })).rejects.toMatchObject({
      code: "stale_version",
      message: expect.stringContaining("changed in another session"),
    });

    vi.mocked(fetchJson).mockRejectedValueOnce(new Error("private vault adapter stack: key custody unavailable at /secret/path"));
    const error = await createAutomationCredential("project", {
      name: "Token",
      kind: "api-token",
      value: "secret",
      scope: "project",
      allowedProjectIds: [],
      capabilities: ["read"],
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AutomationCredentialApiError);
    expect(error).toMatchObject({ code: "backend_unavailable" });
    expect((error as Error).message).not.toContain("/secret/path");
  });
});
