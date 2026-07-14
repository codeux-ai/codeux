import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import {
  CODE_UX_ROLES,
  type CodeUxPrincipal,
  type CodeUxRole,
  type HeadlessAuthMode,
  type HeadlessSecurityConfiguration,
  type RunnerServiceIdentity,
} from "../contracts/headless-security-types.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ROLE_SET = new Set<string>(CODE_UX_ROLES);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export class HeadlessAuthenticationError extends Error {
  constructor(message: string, readonly statusCode: 401 | 403 = 401) {
    super(message);
    this.name = "HeadlessAuthenticationError";
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
}

function roles(value: unknown): CodeUxRole[] {
  return stringArray(value).filter((role): role is CodeUxRole => ROLE_SET.has(role));
}

function parseServiceIdentities(raw: string | undefined): RunnerServiceIdentity[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("CODE_UX_SERVICE_IDENTITIES_JSON must contain valid JSON.");
  }
  if (!Array.isArray(parsed)) throw new Error("CODE_UX_SERVICE_IDENTITIES_JSON must be an array.");
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`Service identity ${index} must be an object.`);
    const value = entry as Record<string, unknown>;
    const id = typeof value.id === "string" ? value.id.trim() : "";
    const tokenSha256 = typeof value.tokenSha256 === "string" ? value.tokenSha256.trim().toLowerCase() : "";
    const parsedRoles = roles(value.roles);
    if (!id || !/^[a-f\d]{64}$/.test(tokenSha256) || parsedRoles.length === 0) {
      throw new Error(`Service identity ${index} requires id, a SHA-256 token digest, and at least one valid role.`);
    }
    return {
      id,
      displayName: typeof value.displayName === "string" && value.displayName.trim() ? value.displayName.trim() : id,
      tokenSha256,
      roles: parsedRoles,
      projectIds: stringArray(value.projectIds),
      enabled: value.enabled !== false,
    };
  });
}

function configuredDashboardIsRemote(): boolean {
  const value = process.env.DASHBOARD_HOST?.trim();
  if (!value) return false;
  try {
    const url = new URL(value.includes("://") ? value : `http://${value}`);
    return !LOCAL_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return true;
  }
}

export function loadHeadlessSecurityConfiguration(): HeadlessSecurityConfiguration {
  const configuredMode = process.env.CODE_UX_DASHBOARD_AUTH_MODE?.trim().toLowerCase();
  const mode: HeadlessAuthMode = configuredMode === "trusted_proxy" || configuredMode === "service_token" || configuredMode === "local"
    ? configuredMode
    : configuredDashboardIsRemote() ? "service_token" : "local";
  return {
    mode,
    trustedProxySecret: process.env.CODE_UX_TRUSTED_PROXY_SECRET?.trim() || undefined,
    serviceIdentities: parseServiceIdentities(process.env.CODE_UX_SERVICE_IDENTITIES_JSON),
    allowInsecureHttp: process.env.CODE_UX_ALLOW_INSECURE_HTTP === "true",
    remoteCredentialManagement: process.env.CODE_UX_REMOTE_CREDENTIAL_MANAGEMENT === "true",
  };
}

function singleHeader(req: Request, name: string): string | null {
  const value = req.headers[name];
  return typeof value === "string" && value.trim() && !value.includes(",") ? value.trim() : null;
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f\d]{64}$/.test(left) || !/^[a-f\d]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function projectIdFromRequest(req: Request): string | null {
  const routeId = req.params?.projectId;
  if (typeof routeId === "string" && routeId.trim()) return routeId.trim();
  const match = req.path.match(/^\/(?:api\/)?projects\/([^/]+)/i);
  if (match?.[1]) return decodeURIComponent(match[1]);
  const bodyProjectId = req.body && typeof req.body === "object" && typeof (req.body as Record<string, unknown>).projectId === "string"
    ? String((req.body as Record<string, unknown>).projectId).trim()
    : "";
  return bodyProjectId || null;
}

function isCredentialManagementRequest(req: Request): boolean {
  const pathname = req.path.toLowerCase();
  return pathname.startsWith("/api/credentials")
    || pathname.startsWith("/credentials")
    || /\/credentials(?:\/|$)/.test(pathname)
    || /\/custom-dashboards\/[^/]+\/credential-bindings(?:\/|$)/.test(pathname)
    || isChatProviderCredentialManagementRequest(req.method, pathname);
}

function isChatProviderCredentialManagementRequest(method: string, pathname: string): boolean {
  if (!pathname.includes("/chat-providers/")) return false;
  const normalizedMethod = method.toUpperCase();
  if (/\/connections\/[^/]+\/verify$/.test(pathname)) return normalizedMethod === "POST";
  if (/\/connections(?:\/[^/]+)?$/.test(pathname)) {
    return normalizedMethod === "POST" || normalizedMethod === "PATCH";
  }
  return false;
}

export function requiredRoleForDashboardRequest(req: Request): CodeUxRole {
  const pathname = req.path.toLowerCase();
  if (pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/")) return "credential_admin";
  if (isCredentialManagementRequest(req)) return "credential_admin";
  if (/\/(?:node-flow(?:s|-drafts|-runs)?|automation-approvals)(?:\/|$)/.test(pathname)) {
    if (/\/(publish|rollback)(?:\/|$)/.test(pathname)) return "automation_publisher";
    if (/\/(run|retry|cancel|decision|approve|approvals)(?:\/|$)/.test(pathname)) return "automation_runner";
    return MUTATING_METHODS.has(req.method) ? "automation_author" : "viewer";
  }
  return MUTATING_METHODS.has(req.method) ? "automation_author" : "viewer";
}

export class HeadlessAuthService {
  constructor(readonly configuration: HeadlessSecurityConfiguration = loadHeadlessSecurityConfiguration()) {
    if (configuration.mode === "trusted_proxy" && !configuration.trustedProxySecret) {
      throw new Error("Trusted-proxy dashboard authentication requires CODE_UX_TRUSTED_PROXY_SECRET.");
    }
  }

  authenticate(req: Request): CodeUxPrincipal {
    if (this.configuration.mode === "local") {
      return {
        id: "local-desktop",
        displayName: "Local desktop operator",
        kind: "local_desktop",
        roles: [...CODE_UX_ROLES],
        projectIds: ["*"],
        authenticatedAt: new Date().toISOString(),
        authenticationMethod: "local",
      };
    }
    this.requireTlsBoundary(req);
    return this.configuration.mode === "trusted_proxy"
      ? this.authenticateTrustedProxy(req)
      : this.authenticateServiceToken(req);
  }

  authorize(req: Request, principal: CodeUxPrincipal, resolvedProjectId?: string | null): void {
    const requiredRole = requiredRoleForDashboardRequest(req);
    if (!principal.roles.includes(requiredRole)) {
      throw new HeadlessAuthenticationError(`Role ${requiredRole} is required.`, 403);
    }
    const projectId = resolvedProjectId ?? projectIdFromRequest(req);
    if (projectId && !principal.projectIds.includes("*") && !principal.projectIds.includes(projectId)) {
      throw new HeadlessAuthenticationError("The authenticated principal is not authorized for this project.", 403);
    }
    if (
      this.configuration.mode !== "local"
      && isCredentialManagementRequest(req)
      && !this.configuration.remoteCredentialManagement
    ) {
      throw new HeadlessAuthenticationError("Remote credential management is disabled.", 403);
    }
  }

  private authenticateServiceToken(req: Request): CodeUxPrincipal {
    const authorization = singleHeader(req, "authorization");
    const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
    if (!match) throw new HeadlessAuthenticationError("Bearer authentication is required.");
    const digest = createHash("sha256").update(match[1], "utf8").digest("hex");
    const identity = this.configuration.serviceIdentities.find((candidate) =>
      candidate.enabled && constantTimeHexEqual(candidate.tokenSha256, digest)
    );
    if (!identity) throw new HeadlessAuthenticationError("Bearer authentication failed.");
    const assertedIdentityId = singleHeader(req, "x-code-ux-service-id");
    if (assertedIdentityId && assertedIdentityId !== identity.id) {
      throw new HeadlessAuthenticationError("Bearer identity assertion does not match the authenticated service.");
    }
    return {
      id: identity.id,
      displayName: identity.displayName,
      kind: "service",
      roles: identity.roles,
      projectIds: identity.projectIds,
      authenticatedAt: new Date().toISOString(),
      authenticationMethod: "service_token",
    };
  }

  private authenticateTrustedProxy(req: Request): CodeUxPrincipal {
    const suppliedSecret = singleHeader(req, "x-code-ux-proxy-secret");
    const expected = this.configuration.trustedProxySecret ?? "";
    const suppliedDigest = createHash("sha256").update(suppliedSecret ?? "", "utf8").digest("hex");
    const expectedDigest = createHash("sha256").update(expected, "utf8").digest("hex");
    if (!suppliedSecret || !constantTimeHexEqual(suppliedDigest, expectedDigest)) {
      throw new HeadlessAuthenticationError("Trusted proxy authentication failed.");
    }
    const id = singleHeader(req, "x-code-ux-principal-id");
    const parsedRoles = roles(singleHeader(req, "x-code-ux-roles")?.split(/\s+/));
    if (!id || parsedRoles.length === 0) throw new HeadlessAuthenticationError("Trusted proxy identity headers are incomplete.");
    return {
      id,
      displayName: singleHeader(req, "x-code-ux-principal-name") ?? id,
      kind: singleHeader(req, "x-code-ux-principal-kind") === "service" ? "service" : "user",
      roles: parsedRoles,
      projectIds: stringArray(singleHeader(req, "x-code-ux-project-ids")?.split(/\s+/)),
      authenticatedAt: new Date().toISOString(),
      authenticationMethod: "trusted_proxy",
    };
  }

  private requireTlsBoundary(req: Request): void {
    if (this.configuration.allowInsecureHttp) return;
    const forwardedProto = singleHeader(req, "x-forwarded-proto");
    if (req.secure || forwardedProto === "https") return;
    throw new HeadlessAuthenticationError("Authenticated remote access requires TLS termination.", 403);
  }
}
