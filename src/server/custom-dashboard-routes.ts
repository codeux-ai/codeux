import type { Express, Request, Response } from "express";
import type {
  CreateCustomDashboardDraftInput,
  CreateCustomDashboardRevisionInput,
  CustomDashboardJsonObject,
  UpdateCustomDashboardDraftInput,
} from "../contracts/custom-dashboard-types.js";
import { HttpRouteError } from "./http-errors.js";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute } from "./route-utils.js";
import { requireTrimmedString } from "./request-parsers.js";
import {
  CustomDashboardRuntimeError,
  type CustomDashboardRuntimeSourceRequest,
} from "../services/custom-dashboard-runtime-service.js";

export function registerCustomDashboardRoutes(app: Express, deps: DashboardDependencies): void {
  app.post("/api/custom-dashboard-runtime/source", asyncRoute(async (req, res) => {
    assertSafeRuntimeRequestOrigin(req);
    const service = requireCustomDashboardRuntimeService(deps);
    const body = requireObjectBody<CustomDashboardRuntimeSourceRequest & { requestId?: unknown }>(req.body);
    const requestId = requireRuntimeRequestId(req, body.requestId);
    try {
      const result = await service.requestSource(requestId, body, requestAbortSignal(req));
      res.setHeader("cache-control", "no-store");
      res.json(result);
    } catch (error) {
      if (!(error instanceof CustomDashboardRuntimeError)) throw error;
      res.status(error.statusCode).json({ requestId, error: { code: error.code, message: error.message } });
    }
  }));

  app.get("/api/projects/:projectId/custom-dashboards", asyncRoute(async (req, res) => {
    const repository = requireCustomDashboardRepository(deps);
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    res.json({ dashboards: repository.listDashboardsByProject(projectId) });
  }));

  app.post("/api/projects/:projectId/custom-dashboards", asyncRoute(async (req, res) => {
    const repository = requireCustomDashboardRepository(deps);
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const dashboard = repository.createDraft(projectId, requireObjectBody<CreateCustomDashboardDraftInput>(req.body));
    res.status(201).json(dashboard);
  }));

  app.get("/api/projects/:projectId/custom-dashboards/data-catalog", asyncRoute(async (req, res) => {
    const repository = requireCustomDashboardRepository(deps);
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const dashboards = repository.listDashboardsByProject(projectId);
    res.json({
      projectId,
      dashboards: dashboards.map((dashboard) => ({
        id: dashboard.id,
        title: dashboard.title,
        status: dashboard.status,
        publishedRevisionId: dashboard.publishedRevisionId,
        sourceNodeGraph: dashboard.sourceNodeGraph,
        credentialBindings: dashboard.credentialBindings,
        routes: dashboard.routes,
      })),
      sources: dashboards.flatMap((dashboard) =>
        dashboard.sourceNodeGraph.nodes.map((node) => ({
          ...node,
          dashboardId: dashboard.id,
          dashboardTitle: dashboard.title,
        }))
      ),
    });
  }));

  app.get("/api/custom-dashboards/:dashboardId", asyncRoute(async (req, res) => {
    const repository = requireCustomDashboardRepository(deps);
    const dashboardId = requireTrimmedString(req.params.dashboardId, "dashboardId");
    const dashboard = repository.getDashboardById(dashboardId);
    if (!dashboard) {
      throw new HttpRouteError(404, `Custom dashboard not found: ${dashboardId}`);
    }
    res.json({ dashboard, revisions: repository.listRevisions(dashboard.id) });
  }));

  app.patch("/api/custom-dashboards/:dashboardId", asyncRoute(async (req, res) => {
    const repository = requireCustomDashboardRepository(deps);
    const dashboard = repository.updateDraft(
      requireTrimmedString(req.params.dashboardId, "dashboardId"),
      requireObjectBody<UpdateCustomDashboardDraftInput>(req.body),
    );
    res.json(dashboard);
  }));

  app.delete("/api/custom-dashboards/:dashboardId", asyncRoute(async (req, res) => {
    const repository = requireCustomDashboardRepository(deps);
    res.json(repository.archiveDashboard(requireTrimmedString(req.params.dashboardId, "dashboardId")));
  }));

  app.post("/api/custom-dashboards/:dashboardId/revisions", asyncRoute(async (req, res) => {
    const repository = requireCustomDashboardRepository(deps);
    const body = optionalObjectBody<CreateCustomDashboardRevisionInput>(req.body);
    const revision = repository.createRevision(
      requireTrimmedString(req.params.dashboardId, "dashboardId"),
      body,
    );
    res.status(201).json(revision);
  }));

  app.post("/api/custom-dashboards/:dashboardId/revisions/:revisionId/validate", asyncRoute(async (req, res) => {
    const service = requireCustomDashboardValidationService(deps);
    const session = await service.startValidation(
      requireProjectIdForRevisionValidation(deps, req),
      requireTrimmedString(req.params.dashboardId, "dashboardId"),
      requireTrimmedString(req.params.revisionId, "revisionId"),
    );
    res.json(session);
  }));

  app.post("/api/custom-dashboards/:dashboardId/revisions/:revisionId/publish", asyncRoute(async (req, res) => {
    assertSafeRuntimeRequestOrigin(req);
    const repository = requireCustomDashboardRepository(deps);
    const body = optionalObjectBody<{ revisionId?: unknown; validationSessionId?: unknown; expectedPublishedRevisionId?: unknown }>(req.body);
    const revisionId = requireTrimmedString(body.revisionId ?? req.params.revisionId, "revisionId");
    const validationSessionId = typeof body.validationSessionId === "string"
      ? body.validationSessionId
      : undefined;
    const dashboard = repository.publishRevision(
      requireTrimmedString(req.params.dashboardId, "dashboardId"),
      revisionId,
      validationSessionId,
      body.expectedPublishedRevisionId === null || typeof body.expectedPublishedRevisionId === "string"
        ? body.expectedPublishedRevisionId
        : undefined,
    );
    res.json(dashboard);
  }));

  app.post("/api/custom-dashboards/:dashboardId/runtime/halt", asyncRoute(async (req, res) => {
    assertSafeRuntimeRequestOrigin(req);
    const repository = requireCustomDashboardRepository(deps);
    const body = requireObjectBody<{ revisionId?: unknown; reason?: unknown; recoveryMetadata?: unknown }>(req.body);
    const dashboard = repository.haltRuntime(
      requireTrimmedString(req.params.dashboardId, "dashboardId"),
      requireTrimmedString(body.revisionId, "revisionId"),
      body.reason,
      body.recoveryMetadata && typeof body.recoveryMetadata === "object" && !Array.isArray(body.recoveryMetadata)
        ? body.recoveryMetadata as CustomDashboardJsonObject
        : undefined,
    );
    res.json(dashboard);
  }));

  app.post("/api/custom-dashboards/:dashboardId/runtime/resume", asyncRoute(async (req, res) => {
    assertSafeRuntimeRequestOrigin(req);
    const repository = requireCustomDashboardRepository(deps);
    const body = requireObjectBody<{ revisionId?: unknown; validationSessionId?: unknown; recoveryMetadata?: unknown }>(req.body);
    const dashboard = repository.resumeRuntime(
      requireTrimmedString(req.params.dashboardId, "dashboardId"),
      requireTrimmedString(body.revisionId, "revisionId"),
      typeof body.validationSessionId === "string" ? body.validationSessionId : undefined,
      body.recoveryMetadata && typeof body.recoveryMetadata === "object" && !Array.isArray(body.recoveryMetadata)
        ? body.recoveryMetadata as CustomDashboardJsonObject
        : undefined,
    );
    res.json(dashboard);
  }));

  app.get("/api/custom-dashboard-validations/:sessionId", asyncRoute(async (req, res) => {
    const service = requireCustomDashboardValidationService(deps);
    const session = await service.getValidationSession(requireTrimmedString(req.params.sessionId, "sessionId"));
    if (!session) {
      throw new HttpRouteError(404, "Custom dashboard validation session not found.");
    }
    res.json(session);
  }));

  app.get("/api/custom-dashboard-validations/:sessionId/logs", asyncRoute(async (req, res) => {
    const service = requireCustomDashboardValidationService(deps);
    const tail = typeof req.query.tail === "string" ? Number(req.query.tail) : undefined;
    res.json(await service.getValidationLogs(requireTrimmedString(req.params.sessionId, "sessionId"), tail));
  }));

  app.post("/api/custom-dashboard-validations/:sessionId/stop", asyncRoute(async (req, res) => {
    const service = requireCustomDashboardValidationService(deps);
    res.json(await service.stopValidation(requireTrimmedString(req.params.sessionId, "sessionId")));
  }));

  app.delete("/api/custom-dashboard-validations/:sessionId", asyncRoute(async (req, res) => {
    const service = requireCustomDashboardValidationService(deps);
    await service.removeValidation(requireTrimmedString(req.params.sessionId, "sessionId"));
    res.status(204).end();
  }));

  app.all("/api/custom-dashboard-validations/:sessionId/proxy{*rest}", asyncRoute(async (req, res) => {
    const service = requireCustomDashboardValidationService(deps);
    const sessionId = requireTrimmedString(req.params.sessionId, "sessionId");
    const prefix = `/api/custom-dashboard-validations/${sessionId}/proxy`;
    const proxied = await service.proxyValidationRequest(buildProxyRequestArgs(req, sessionId, prefix));
    sendProxiedResponse(res, proxied);
  }));

  app.all("/api/custom-dashboards/validation-sessions/:sessionId/proxy{*rest}", asyncRoute(async (req, res) => {
    const service = requireCustomDashboardValidationService(deps);
    const sessionId = requireTrimmedString(req.params.sessionId, "sessionId");
    const prefix = `/api/custom-dashboards/validation-sessions/${sessionId}/proxy`;
    const proxied = await service.proxyValidationRequest(buildProxyRequestArgs(req, sessionId, prefix));
    sendProxiedResponse(res, proxied);
  }));
}

function requireCustomDashboardRuntimeService(
  deps: DashboardDependencies,
): NonNullable<DashboardDependencies["customDashboardRuntimeService"]> {
  if (!deps.customDashboardRuntimeService) {
    throw new HttpRouteError(503, "Custom dashboard source runtime is unavailable.");
  }
  return deps.customDashboardRuntimeService;
}

function requireRuntimeRequestId(req: Request, bodyRequestId: unknown): string {
  const value = typeof bodyRequestId === "string"
    ? bodyRequestId
    : typeof req.headers["x-request-id"] === "string"
      ? req.headers["x-request-id"]
      : "";
  const requestId = value.trim();
  if (!requestId || requestId.length > 128 || !/^[a-zA-Z0-9._:-]+$/.test(requestId)) {
    throw new HttpRouteError(400, "A valid custom dashboard runtime requestId is required.");
  }
  return requestId;
}

function assertSafeRuntimeRequestOrigin(req: Request): void {
  const site = req.headers["sec-fetch-site"];
  if (typeof site === "string" && !["same-origin", "same-site", "none"].includes(site)) {
    throw new HttpRouteError(403, "Cross-site custom dashboard runtime requests are not allowed.");
  }
  const origin = req.headers.origin;
  if (!origin) return;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new HttpRouteError(403, "Custom dashboard runtime request origin is invalid.");
  }
  if (parsed.host !== req.get("host")) {
    throw new HttpRouteError(403, "Cross-origin custom dashboard runtime requests are not allowed.");
  }
}

function requestAbortSignal(req: Request): AbortSignal {
  const controller = new AbortController();
  req.once("aborted", () => controller.abort(new Error("Custom dashboard runtime request was cancelled.")));
  return controller.signal;
}

function requireCustomDashboardRepository(deps: DashboardDependencies): NonNullable<DashboardDependencies["customDashboardRepository"]> {
  if (!deps.customDashboardRepository) {
    throw new Error("Custom dashboard repository is unavailable.");
  }
  return deps.customDashboardRepository;
}

function requireCustomDashboardValidationService(
  deps: DashboardDependencies,
): NonNullable<DashboardDependencies["customDashboardValidationService"]> {
  if (!deps.customDashboardValidationService) {
    throw new Error("Custom dashboard validation runtime is unavailable.");
  }
  return deps.customDashboardValidationService;
}

function requireProjectIdForRevisionValidation(deps: DashboardDependencies, req: Request): string {
  const projectId = typeof req.body?.projectId === "string"
    ? req.body.projectId
    : deps.customDashboardRepository
      ?.getRevisionById(requireTrimmedString(req.params.revisionId, "revisionId"))
      ?.projectId;
  return requireTrimmedString(projectId, "projectId");
}

function requireObjectBody<T extends object>(body: unknown): T {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid input: body must be an object");
  }
  return body as T;
}

function optionalObjectBody<T extends object>(body: unknown): T {
  if (body === undefined || body === null || (typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0)) {
    return {} as T;
  }
  return requireObjectBody<T>(body);
}

function buildProxyRequestArgs(
  req: Request,
  sessionId: string,
  prefix: string,
): {
  sessionId: string;
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  bodyBytes?: Buffer;
  rewritePrefix: string;
} {
  const path = req.originalUrl.startsWith(prefix)
    ? req.originalUrl.slice(prefix.length) || "/"
    : "/";
  const bodyBytes = req.body === undefined || req.body === null
    ? undefined
    : Buffer.isBuffer(req.body)
      ? req.body
      : null;
  if (bodyBytes === null) {
    throw new HttpRouteError(400, "Proxied custom dashboard validation requests must use a raw request body");
  }
  if (bodyBytes && bodyBytes.byteLength > 5 * 1024 * 1024) {
    throw new HttpRouteError(413, "Request body exceeds maximum allowed size for proxied custom dashboard validation");
  }
  return {
    sessionId,
    method: req.method,
    path,
    headers: Object.fromEntries(
      Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value]),
    ) as Record<string, string | undefined>,
    bodyBytes,
    rewritePrefix: prefix,
  };
}

function sendProxiedResponse(
  res: Response,
  proxied: { status: number; headers: Record<string, string>; body: Buffer },
): void {
  for (const [key, value] of Object.entries(proxied.headers)) {
    res.setHeader(key, value);
  }
  res.status(proxied.status).send(proxied.body);
}
