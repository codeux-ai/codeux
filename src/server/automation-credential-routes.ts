import type { Express } from "express";
import type {
  AutomationCredentialCompatibilityInput,
  BindAutomationCredentialInput,
  CreateAutomationCredentialInput,
  PromoteAutomationCredentialInput,
  ReplaceAutomationCredentialSecretInput,
  RestrictAutomationCredentialInput,
  RevokeAutomationCredentialInput,
  TestAutomationCredentialInput,
  UpdateAutomationCredentialMetadataInput,
} from "../contracts/automation-credential-types.js";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute } from "./route-utils.js";
import { requireTrimmedString } from "./request-parsers.js";

function broker(deps: DashboardDependencies) {
  if (!deps.credentialBroker) throw new Error("Credential broker is not enabled.");
  return deps.credentialBroker;
}

function routeIds(params: Record<string, unknown>): { projectId: string; credentialId: string } {
  return {
    projectId: requireTrimmedString(params.projectId, "projectId"),
    credentialId: requireTrimmedString(params.credentialId, "credentialId"),
  };
}

export function registerAutomationCredentialRoutes(app: Express, deps: DashboardDependencies): void {
  app.get("/api/credentials/health", asyncRoute(async (_req, res) => {
    res.json(await broker(deps).health());
  }));

  app.get("/api/projects/:projectId/credentials", asyncRoute(async (req, res) => {
    res.json(broker(deps).list(requireTrimmedString(req.params.projectId, "projectId")));
  }));

  app.post("/api/projects/:projectId/credentials", asyncRoute(async (req, res) => {
    const metadata = await broker(deps).create(
      requireTrimmedString(req.params.projectId, "projectId"),
      req.body as CreateAutomationCredentialInput,
    );
    res.status(201).json(metadata);
  }));

  app.patch("/api/projects/:projectId/credentials/:credentialId", asyncRoute(async (req, res) => {
    const ids = routeIds(req.params);
    res.json(broker(deps).updateMetadata(ids.projectId, ids.credentialId, req.body as UpdateAutomationCredentialMetadataInput));
  }));

  app.post("/api/projects/:projectId/credentials/:credentialId/bind", asyncRoute(async (req, res) => {
    const ids = routeIds(req.params);
    res.json(broker(deps).bind(ids.projectId, ids.credentialId, req.body as BindAutomationCredentialInput));
  }));

  app.post("/api/projects/:projectId/credentials/:credentialId/compatibility", asyncRoute(async (req, res) => {
    const ids = routeIds(req.params);
    const body = req.body as Omit<AutomationCredentialCompatibilityInput, "projectId">;
    res.json(await broker(deps).assessCompatibility(ids.credentialId, { ...body, projectId: ids.projectId }));
  }));

  app.post("/api/projects/:projectId/credentials/:credentialId/test", asyncRoute(async (req, res) => {
    const ids = routeIds(req.params);
    res.json(await broker(deps).test(ids.projectId, ids.credentialId, req.body as TestAutomationCredentialInput));
  }));

  app.post("/api/projects/:projectId/credentials/:credentialId/rotate", asyncRoute(async (req, res) => {
    const ids = routeIds(req.params);
    res.json(await broker(deps).rotate(ids.projectId, ids.credentialId, req.body as ReplaceAutomationCredentialSecretInput));
  }));

  app.post("/api/projects/:projectId/credentials/:credentialId/replace", asyncRoute(async (req, res) => {
    const ids = routeIds(req.params);
    res.json(await broker(deps).replace(ids.projectId, ids.credentialId, req.body as ReplaceAutomationCredentialSecretInput));
  }));

  app.post("/api/projects/:projectId/credentials/:credentialId/revoke", asyncRoute(async (req, res) => {
    const ids = routeIds(req.params);
    res.json(broker(deps).revoke(ids.projectId, ids.credentialId, req.body as RevokeAutomationCredentialInput));
  }));

  app.post("/api/projects/:projectId/credentials/:credentialId/promote", asyncRoute(async (req, res) => {
    const ids = routeIds(req.params);
    res.json(await broker(deps).promote(ids.projectId, ids.credentialId, req.body as PromoteAutomationCredentialInput));
  }));

  app.post("/api/projects/:projectId/credentials/:credentialId/restrict", asyncRoute(async (req, res) => {
    const ids = routeIds(req.params);
    res.json(broker(deps).restrict(ids.projectId, ids.credentialId, req.body as RestrictAutomationCredentialInput));
  }));
}
