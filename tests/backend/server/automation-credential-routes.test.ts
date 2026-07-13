import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { CredentialConcurrentModificationError } from "../../../src/repositories/automation-credential-repository.js";
import { registerAutomationCredentialRoutes } from "../../../src/server/automation-credential-routes.js";
import { toHttpRouteError } from "../../../src/server/http-errors.js";
import {
  CredentialAccessDeniedError,
  CredentialEncryptedStateError,
  CredentialKeyCustodyUnavailableError,
} from "../../../src/services/credentials/credential-broker.js";

const metadata = {
  id: "credential-1",
  name: "Token",
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
};

function app(credentialBroker: Record<string, unknown>) {
  const application = express();
  application.use(express.json());
  registerAutomationCredentialRoutes(application, { credentialBroker } as never);
  return application;
}

describe("automation credential routes", () => {
  it("passes secrets only into explicit write operations and returns metadata", async () => {
    const canary = "ROUTE_SECRET_CANARY";
    const credentialBroker = {
      create: vi.fn().mockResolvedValue(metadata),
      rotate: vi.fn().mockResolvedValue({ ...metadata, version: 2 }),
    };
    const createResponse = await request(app(credentialBroker))
      .post("/api/projects/project-1/credentials")
      .send({
        name: "Token",
        kind: "api-token",
        value: canary,
        scope: "project",
        allowedProjectIds: [],
        capabilities: ["read"],
      });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toEqual(metadata);
    expect(JSON.stringify(createResponse.body)).not.toContain(canary);
    expect(credentialBroker.create).toHaveBeenCalledWith("project-1", expect.objectContaining({ value: canary }));

    const rotateResponse = await request(app(credentialBroker))
      .post("/api/projects/project-1/credentials/credential-1/rotate")
      .send({ value: canary, expectedVersion: 1 });
    expect(rotateResponse.status).toBe(200);
    expect(rotateResponse.body).toMatchObject({ id: "credential-1", version: 2 });
    expect(JSON.stringify(rotateResponse.body)).not.toContain(canary);
    expect(credentialBroker.rotate).toHaveBeenCalledWith("project-1", "credential-1", { value: canary, expectedVersion: 1 });
  });

  it("forwards explicit lifecycle and compatibility request contracts", async () => {
    const credentialBroker = {
      updateMetadata: vi.fn().mockReturnValue({ ...metadata, name: "Renamed", version: 2 }),
      test: vi.fn().mockResolvedValue({ ...metadata, validationStatus: "valid", version: 2 }),
      revoke: vi.fn().mockReturnValue({ ...metadata, status: "revoked", version: 2 }),
      assessCompatibility: vi.fn().mockResolvedValue({ credentialId: metadata.id, compatible: true }),
    };
    await request(app(credentialBroker)).patch("/api/projects/project-1/credentials/credential-1")
      .send({ name: "Renamed", expectedVersion: 1 }).expect(200);
    expect(credentialBroker.updateMetadata).toHaveBeenCalledWith("project-1", "credential-1", { name: "Renamed", expectedVersion: 1 });
    await request(app(credentialBroker)).post("/api/projects/project-1/credentials/credential-1/test")
      .send({ expectedVersion: 1 }).expect(200);
    expect(credentialBroker.test).toHaveBeenCalledWith("project-1", "credential-1", { expectedVersion: 1 });
    await request(app(credentialBroker)).post("/api/projects/project-1/credentials/credential-1/revoke")
      .send({ expectedVersion: 1 }).expect(200);
    expect(credentialBroker.revoke).toHaveBeenCalledWith("project-1", "credential-1", { expectedVersion: 1 });
    await request(app(credentialBroker)).post("/api/projects/project-1/credentials/credential-1/compatibility")
      .send({ allowedKinds: ["api-token"], requiredCapabilities: ["read"] }).expect(200);
    expect(credentialBroker.assessCompatibility).toHaveBeenCalledWith("credential-1", {
      projectId: "project-1",
      allowedKinds: ["api-token"],
      requiredCapabilities: ["read"],
    });
  });

  it("maps credential failures to stable typed HTTP outcomes", () => {
    expect(toHttpRouteError(new CredentialAccessDeniedError("Credential is not managed by this project."))).toMatchObject({ status: 403 });
    expect(toHttpRouteError(new CredentialConcurrentModificationError("Credential changed; retry."))).toMatchObject({ status: 409 });
    expect(toHttpRouteError(new CredentialKeyCustodyUnavailableError())).toMatchObject({ status: 503 });
    expect(toHttpRouteError(new CredentialEncryptedStateError())).toMatchObject({ status: 422 });
  });

  it("returns actionable typed failure messages without serialized request secrets", async () => {
    const canary = "ROUTE_ERROR_SECRET_CANARY";
    const credentialBroker = {
      rotate: vi.fn().mockRejectedValue(new CredentialKeyCustodyUnavailableError()),
      test: vi.fn().mockRejectedValue(new CredentialEncryptedStateError()),
    };
    const custody = await request(app(credentialBroker))
      .post("/api/projects/project-1/credentials/credential-1/rotate")
      .send({ value: canary, expectedVersion: 1 });
    expect(custody.status).toBe(503);
    expect(custody.body.error).toMatch(/restore the configured secure key provider/);
    expect(JSON.stringify(custody.body)).not.toContain(canary);
    const invalid = await request(app(credentialBroker))
      .post("/api/projects/project-1/credentials/credential-1/test")
      .send({ expectedVersion: 1 });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error).toMatch(/replace its value with the current version/);
  });
});
