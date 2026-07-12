import type {
  CustomDashboardDataSourceNode,
  CustomDashboardJsonObject,
  CustomDashboardJsonValue,
  CustomDashboardRevisionRecord,
} from "../contracts/custom-dashboard-types.js";
import type { CustomDashboardRepository } from "../repositories/custom-dashboard-repository.js";
import { ValidationError } from "../repositories/repository-utils.js";
import type { CredentialBroker } from "./credentials/credential-broker.js";
import type { EgressPolicy, EgressPolicyService } from "./node-flows/egress-policy-service.js";

const BUILT_IN_SOURCE_TYPES = new Map<string, "execution" | "stats" | "telemetry" | "integrations">([
  ["project_dashboard_data", "execution"],
  ["project_dashboard", "execution"],
  ["dashboard_data", "execution"],
  ["stats", "stats"],
  ["project_stats", "stats"],
  ["telemetry", "telemetry"],
  ["overview_telemetry", "telemetry"],
  ["integrations_metadata", "integrations"],
  ["integrations", "integrations"],
]);
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const SAFE_RESPONSE_HEADERS = new Set(["cache-control", "content-language", "content-type", "etag", "last-modified"]);
const MAX_REQUEST_BODY_BYTES = 256 * 1024;
const MAX_ERROR_LENGTH = 320;

export type CustomDashboardRuntimeAccess =
  | { kind: "published" }
  | { kind: "validation"; sessionId: string };

export interface CustomDashboardRuntimeSourceRequest {
  projectId: string;
  dashboardId: string;
  revisionId: string;
  access: CustomDashboardRuntimeAccess;
  sourceId: string;
  route?: string;
  method?: string;
  credentialSlot?: string;
  capability?: string;
  headers?: Record<string, string>;
  body?: CustomDashboardJsonValue;
}

export interface CustomDashboardRuntimeSourceResponse {
  requestId: string;
  sourceId: string;
  status: number;
  headers: Record<string, string>;
  data: CustomDashboardJsonValue;
}

export class CustomDashboardRuntimeError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message.slice(0, MAX_ERROR_LENGTH));
    this.name = "CustomDashboardRuntimeError";
  }
}

export interface CustomDashboardRuntimeServiceDeps {
  customDashboardRepository: CustomDashboardRepository;
  credentialBroker?: CredentialBroker;
  egressPolicyService: EgressPolicyService;
  getProjectExecutionSnapshot: (projectId: string) => unknown;
  getProjectStatsSnapshot: (projectId: string, query: { window: "1h" | "24h" | "7d" | "30d" | "all" }) => unknown;
  getOverviewTelemetrySnapshot: () => unknown;
}

interface ExternalRoutePolicy {
  path: string;
  methods: string[];
}

export class CustomDashboardRuntimeService {
  constructor(private readonly deps: CustomDashboardRuntimeServiceDeps) {}

  async requestSource(
    requestId: string,
    input: CustomDashboardRuntimeSourceRequest,
    signal?: AbortSignal,
  ): Promise<CustomDashboardRuntimeSourceResponse> {
    const request = normalizeRequest(input);
    const revision = this.authorizeRevision(request);
    const source = revision.sourceNodeGraph.nodes.find((candidate) => candidate.id === request.sourceId);
    if (!source) {
      throw new CustomDashboardRuntimeError(404, "source_not_declared", "The requested custom dashboard source is not declared.");
    }
    const builtIn = BUILT_IN_SOURCE_TYPES.get(source.type);
    if (builtIn) {
      return {
        requestId,
        sourceId: source.id,
        status: 200,
        headers: { "content-type": "application/json" },
        data: toJsonValue(this.readBuiltInSource(builtIn, revision, source)),
      };
    }
    if (source.type !== "external_api") {
      throw new CustomDashboardRuntimeError(400, "unsupported_source", "The requested custom dashboard source type is unsupported.");
    }
    return await this.requestExternalSource(requestId, request, revision, source, signal);
  }

  private authorizeRevision(request: NormalizedRuntimeRequest): CustomDashboardRevisionRecord {
    const dashboard = this.deps.customDashboardRepository.getDashboardById(request.dashboardId);
    const revision = this.deps.customDashboardRepository.getRevisionById(request.revisionId);
    if (!dashboard || !revision
      || dashboard.projectId !== request.projectId
      || revision.projectId !== request.projectId
      || revision.dashboardId !== dashboard.id) {
      throw new CustomDashboardRuntimeError(404, "runtime_not_found", "The custom dashboard runtime was not found.");
    }
    if (request.access.kind === "published") {
      if (dashboard.runtimeState.status === "halted") {
        throw new CustomDashboardRuntimeError(423, "runtime_halted", "The custom dashboard runtime is halted and requires an explicit validated resume or rollback.");
      }
      if (dashboard.status !== "published" || dashboard.publishedRevisionId !== revision.id
        || revision.validationStatus !== "passed" || revision.validationReport?.valid !== true) {
        throw new CustomDashboardRuntimeError(403, "publication_denied", "The requested revision is not the active published dashboard revision.");
      }
      return revision;
    }
    const session = this.deps.customDashboardRepository.getValidationSessionById(request.access.sessionId);
    if (!session || session.projectId !== request.projectId || session.dashboardId !== dashboard.id
      || session.revisionId !== revision.id || ["failed", "cancelled"].includes(session.status)) {
      throw new CustomDashboardRuntimeError(403, "validation_session_denied", "The validation session does not own the requested dashboard revision.");
    }
    return revision;
  }

  private readBuiltInSource(
    kind: "execution" | "stats" | "telemetry" | "integrations",
    revision: CustomDashboardRevisionRecord,
    source: CustomDashboardDataSourceNode,
  ): unknown {
    if (kind === "execution") return this.deps.getProjectExecutionSnapshot(revision.projectId);
    if (kind === "telemetry") return this.deps.getOverviewTelemetrySnapshot();
    if (kind === "stats") {
      const window = normalizeStatsWindow(source.config?.window);
      return this.deps.getProjectStatsSnapshot(revision.projectId, { window });
    }
    return {
      available: true,
      source: { id: source.id, type: source.type, title: source.title, config: source.config ?? {} },
      note: "Integration metadata is limited to the non-secret source declaration.",
    };
  }

  private async requestExternalSource(
    requestId: string,
    request: NormalizedRuntimeRequest,
    revision: CustomDashboardRevisionRecord,
    source: CustomDashboardDataSourceNode,
    signal?: AbortSignal,
  ): Promise<CustomDashboardRuntimeSourceResponse> {
    const config = source.config ?? {};
    const baseUrl = requiredString(config.baseUrl, "External source baseUrl is required.");
    const routePolicies = parseExternalRoutes(config.routes);
    const route = request.route || (routePolicies.length === 1 ? routePolicies[0]!.path : "");
    const routePolicy = routePolicies.find((candidate) => candidate.path === route);
    if (!routePolicy) {
      throw new CustomDashboardRuntimeError(403, "route_denied", "The requested external source route is not declared.");
    }
    const method = request.method || "GET";
    if (!routePolicy.methods.includes(method)) {
      throw new CustomDashboardRuntimeError(403, "method_denied", "The requested method is not allowed for this source route.");
    }
    const base = parseExternalBaseUrl(baseUrl);
    const url = new URL(route.replace(/^\//, ""), ensureTrailingSlash(base.toString()));
    if (url.origin !== base.origin) {
      throw new CustomDashboardRuntimeError(403, "route_denied", "The requested route leaves the declared external source origin.");
    }
    const slot = resolveCredentialSlot(source, request.credentialSlot);
    const capability = request.capability || slot?.requiredCapability || "read";
    if (slot && capability !== slot.requiredCapability) {
      throw new CustomDashboardRuntimeError(403, "capability_denied", "The requested credential capability is not declared for this source.");
    }
    const binding = slot ? revision.credentialBindings.find((candidate) => candidate.slot === slot.slot) : undefined;
    if (slot?.required && !binding) {
      throw new CustomDashboardRuntimeError(403, "credential_missing", "The required source credential is not bound.");
    }
    if (request.credentialSlot && !slot) {
      throw new CustomDashboardRuntimeError(403, "credential_slot_denied", "The requested credential slot is not declared for this source.");
    }
    if (binding && (binding.capability !== capability || binding.credential.status !== "active"
      || !slot?.allowedKinds.includes(binding.credential.kind))) {
      throw new CustomDashboardRuntimeError(403, "credential_denied", "The declared source credential is unavailable.");
    }

    const invoke = async (secret?: Buffer): Promise<CustomDashboardRuntimeSourceResponse> => {
      const credentialHeaders = secret && slot ? buildCredentialHeaders(slot.metadata, secret.toString("utf8")) : undefined;
      try {
        const response = await this.deps.egressPolicyService.request({
          url,
          method,
          headers: request.headers,
          credentialHeaders,
          body: request.body === undefined ? undefined : JSON.stringify(request.body),
          signal,
          rateLimitKey: `custom-dashboard:${revision.dashboardId}:${source.id}`,
          policy: buildEgressPolicy(config),
        });
        if (!response.ok) {
          throw new CustomDashboardRuntimeError(502, "upstream_rejected", "The external dashboard source returned an error response.");
        }
        const data = response.body.byteLength === 0
          ? null
          : response.contentType === "application/json"
            ? toJsonValue(response.json())
            : response.text();
        return {
          requestId,
          sourceId: source.id,
          status: response.status,
          headers: sanitizeResponseHeaders(response.headers),
          data,
        };
      } catch (error) {
        if (error instanceof CustomDashboardRuntimeError) throw error;
        const code = error instanceof ValidationError ? "egress_denied" : "upstream_failed";
        throw new CustomDashboardRuntimeError(502, code, "The external dashboard source request was denied or failed.");
      }
    };

    if (!binding) return await invoke();
    if (!this.deps.credentialBroker) {
      throw new CustomDashboardRuntimeError(503, "credential_broker_unavailable", "The dashboard credential broker is unavailable.");
    }
    try {
      return await this.deps.credentialBroker.withResolvedCredentialId({
        projectId: revision.projectId,
        bindingKey: binding.bindingKey,
        capability,
        workspaceId: `custom-dashboard:${revision.dashboardId}:${revision.id}`,
        credentialId: binding.credentialId,
      }, invoke);
    } catch (error) {
      if (error instanceof CustomDashboardRuntimeError) throw error;
      throw new CustomDashboardRuntimeError(403, "credential_denied", "The declared source credential is unavailable.");
    }
  }
}

interface NormalizedRuntimeRequest extends Omit<CustomDashboardRuntimeSourceRequest, "method"> {
  method: string;
}

function normalizeRequest(input: CustomDashboardRuntimeSourceRequest): NormalizedRuntimeRequest {
  if (!input || typeof input !== "object") throw new CustomDashboardRuntimeError(400, "invalid_request", "Invalid runtime source request.");
  const projectId = boundedIdentifier(input.projectId, "projectId");
  const dashboardId = boundedIdentifier(input.dashboardId, "dashboardId");
  const revisionId = boundedIdentifier(input.revisionId, "revisionId");
  const sourceId = boundedIdentifier(input.sourceId, "sourceId");
  if (!input.access || (input.access.kind !== "published" && input.access.kind !== "validation")) {
    throw new CustomDashboardRuntimeError(400, "invalid_access", "A published or validation runtime access context is required.");
  }
  const access = input.access.kind === "validation"
    ? { kind: "validation" as const, sessionId: boundedIdentifier(input.access.sessionId, "sessionId") }
    : { kind: "published" as const };
  const method = (input.method || "GET").trim().toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw new CustomDashboardRuntimeError(400, "invalid_method", "The runtime source method is unsupported.");
  if (input.body !== undefined && Buffer.byteLength(JSON.stringify(input.body)) > MAX_REQUEST_BODY_BYTES) {
    throw new CustomDashboardRuntimeError(413, "request_too_large", "The runtime source request body is too large.");
  }
  return { ...input, projectId, dashboardId, revisionId, sourceId, access, method };
}

function boundedIdentifier(value: unknown, field: string): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > 256 || /[\u0000-\u001f\u007f]/.test(result)) {
    throw new CustomDashboardRuntimeError(400, "invalid_request", `Invalid ${field}.`);
  }
  return result;
}

function parseExternalRoutes(value: CustomDashboardJsonValue | undefined): ExternalRoutePolicy[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new CustomDashboardRuntimeError(400, "source_misconfigured", "External sources must declare one or more allowed routes.");
  }
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new CustomDashboardRuntimeError(400, "source_misconfigured", "External source route policy is invalid.");
    }
    const path = requiredString(candidate.path, "External source route path is required.");
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("?") || path.includes("#") || path.split("/").includes("..")) {
      throw new CustomDashboardRuntimeError(400, "source_misconfigured", "External source route path is invalid.");
    }
    const rawMethods = Array.isArray(candidate.methods) ? candidate.methods : ["GET"];
    const methods = rawMethods.map((item) => requiredString(item, "External source route method is invalid.").toUpperCase());
    if (methods.some((method) => !ALLOWED_METHODS.has(method))) {
      throw new CustomDashboardRuntimeError(400, "source_misconfigured", "External source route method is unsupported.");
    }
    return { path, methods: [...new Set(methods)] };
  });
}

function resolveCredentialSlot(source: CustomDashboardDataSourceNode, requested?: string) {
  const slots = source.credentialSlots ?? [];
  if (requested) return slots.find((slot) => slot.slot === requested);
  return slots.length === 1 ? slots[0] : undefined;
}

function buildCredentialHeaders(metadata: CustomDashboardJsonObject | undefined, value: string): Record<string, string> {
  const headerName = optionalString(metadata?.headerName) || "authorization";
  if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(headerName)) {
    throw new CustomDashboardRuntimeError(400, "source_misconfigured", "Credential header name is invalid.");
  }
  const scheme = optionalString(metadata?.scheme);
  return { [headerName]: scheme ? `${scheme} ${value}` : value };
}

function buildEgressPolicy(config: CustomDashboardJsonObject): EgressPolicy {
  const allowedHosts = stringArray(config.allowedHosts);
  if (allowedHosts.length === 0) {
    throw new CustomDashboardRuntimeError(400, "source_misconfigured", "External sources must declare allowedHosts.");
  }
  return {
    allowHttp: config.allowHttp === true,
    allowedHosts,
    allowedPorts: numberArray(config.allowedPorts),
    allowedContentTypes: stringArray(config.allowedContentTypes).length > 0
      ? stringArray(config.allowedContentTypes)
      : ["application/json", "text/"],
    timeoutMs: boundedNumber(config.timeoutMs, 10_000, 1, 30_000),
    maxRedirects: boundedNumber(config.maxRedirects, 2, 0, 5),
    maxResponseBytes: boundedNumber(config.maxResponseBytes, 1024 * 1024, 1, 5 * 1024 * 1024),
    requestsPerMinute: boundedNumber(config.requestsPerMinute, 60, 1, 600),
    maxRetries: 0,
  };
}

function sanitizeResponseHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => SAFE_RESPONSE_HEADERS.has(name.toLowerCase())));
}

function requiredString(value: unknown, message: string): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > 2048 || /[\r\n\0]/.test(result)) throw new CustomDashboardRuntimeError(400, "source_misconfigured", message);
  return result;
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStatsWindow(value: unknown): "1h" | "24h" | "7d" | "30d" | "all" {
  return value === "1h" || value === "24h" || value === "30d" || value === "all" ? value : "7d";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function numberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.filter((item): item is number => typeof item === "number" && Number.isInteger(item) && item > 0 && item <= 65535);
  return result.length > 0 ? result : undefined;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function parseExternalBaseUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
    return url;
  } catch {
    throw new CustomDashboardRuntimeError(400, "source_misconfigured", "External source baseUrl is invalid.");
  }
}

function toJsonValue(value: unknown): CustomDashboardJsonValue {
  const serialized = JSON.stringify(value ?? null);
  return JSON.parse(serialized) as CustomDashboardJsonValue;
}
