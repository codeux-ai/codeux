import type {
  CreateCustomDashboardDraftInput,
  CreateCustomDashboardRevisionInput,
  CustomDashboardDataSourceNode,
  UpdateCustomDashboardDraftInput,
} from "../../contracts/custom-dashboard-types.js";
import type {
  ManageCodeUxArgs,
  ManagementResponseEnvelope,
} from "../../contracts/internal-management-types.js";
import type { CustomDashboardRepository } from "../../repositories/custom-dashboard-repository.js";
import type { CustomDashboardValidationService } from "../../services/custom-dashboard-validation-service.js";
import {
  managementValidationError,
  parseOptionalObject,
  parseOptionalString,
  parseRequiredObject,
  parseRequiredString,
} from "./payload-parsers.js";

export class CustomDashboardActions {
  constructor(
    private readonly customDashboardRepository: CustomDashboardRepository,
    private readonly customDashboardValidationService: CustomDashboardValidationService,
  ) {}

  async handleCustomDashboardAction(args: ManageCodeUxArgs): Promise<ManagementResponseEnvelope> {
    const payload = args.payload || {};
    switch (args.action) {
      case "list":
        return this.listDashboards(payload);
      case "get":
        return this.getDashboard(payload);
      case "create":
        return this.createDashboard(payload);
      case "update":
        return this.updateDashboard(payload);
      case "create_revision":
        return this.createRevision(payload);
      case "validate_revision":
        return await this.validateRevision(payload);
      case "validation_status":
        return await this.validationStatus(payload);
      case "validation_logs":
        return await this.validationLogs(payload);
      case "publish_revision":
        return this.publishRevision(payload);
      case "archive":
        return this.archiveDashboard(args, payload);
      case "data_catalog":
        return this.dataCatalog(payload);
      default:
        throw managementValidationError(`Unknown custom dashboard action: ${args.action}`, "action");
    }
  }

  private listDashboards(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    return { result: { dashboards: this.customDashboardRepository.listDashboardsByProject(projectId) } };
  }

  private getDashboard(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const dashboardId = parseRequiredString(payload, "dashboardId");
    const dashboard = this.customDashboardRepository.getDashboardById(dashboardId);
    if (!dashboard) {
      throw managementValidationError(`Custom dashboard not found: ${dashboardId}`, "dashboardId");
    }
    return {
      result: {
        dashboard,
        revisions: this.customDashboardRepository.listRevisions(dashboard.id),
      },
    };
  }

  private createDashboard(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const draft = parseDashboardDraftPayload(payload, true);
    const dashboard = this.customDashboardRepository.createDraft(projectId, {
      title: parseRequiredString(payload, "title"),
      manifest: draft.manifest,
      fileBundle: draft.fileBundle,
      description: draft.description,
      sourceNodeGraph: draft.sourceNodeGraph,
      credentialBindings: draft.credentialBindings,
      routes: draft.routes,
      styleguide: draft.styleguide,
      runtimeMetadata: draft.runtimeMetadata,
    });
    return { result: { dashboard } };
  }

  private updateDashboard(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const dashboardId = parseRequiredString(payload, "dashboardId");
    const dashboard = this.customDashboardRepository.updateDraft(
      dashboardId,
      parseDashboardDraftPayload(payload, false),
    );
    return { result: { dashboard } };
  }

  private createRevision(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const dashboardId = parseRequiredString(payload, "dashboardId");
    const revision = this.customDashboardRepository.createRevision(
      dashboardId,
      parseRevisionPayload(payload),
    );
    return { result: { revision } };
  }

  private async validateRevision(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const projectId = parseRequiredString(payload, "projectId");
    const dashboardId = parseRequiredString(payload, "dashboardId");
    const revisionId = parseRequiredString(payload, "revisionId");
    const session = await this.customDashboardValidationService.startValidation(projectId, dashboardId, revisionId);
    return { result: { session } };
  }

  private async validationStatus(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const sessionId = parseRequiredString(payload, "sessionId");
    const session = await this.customDashboardValidationService.getValidationSession(sessionId);
    if (!session) {
      throw managementValidationError(`Custom dashboard validation session not found: ${sessionId}`, "sessionId");
    }
    return { result: { session } };
  }

  private async validationLogs(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const sessionId = parseRequiredString(payload, "sessionId");
    const tail = parseTail(payload);
    return { result: await this.customDashboardValidationService.getValidationLogs(sessionId, tail) };
  }

  private publishRevision(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const dashboard = this.customDashboardRepository.publishRevision(
      parseRequiredString(payload, "dashboardId"),
      parseRequiredString(payload, "revisionId"),
      parseOptionalString(payload, "validationSessionId"),
    );
    return { result: { dashboard } };
  }

  private archiveDashboard(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const dashboardId = parseRequiredString(payload, "dashboardId");
    if (args.approval?.confirmed !== true) {
      return {
        approvalRequired: true,
        approvalMessage: `Archiving custom dashboard ${dashboardId} removes its active publication. Call again with approval.confirmed true after human approval.`,
      };
    }
    return { result: { dashboard: this.customDashboardRepository.archiveDashboard(dashboardId) } };
  }

  private dataCatalog(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const dashboards = this.customDashboardRepository.listDashboardsByProject(projectId);
    const sources: Array<CustomDashboardDataSourceNode & { dashboardId: string; dashboardTitle: string }> = dashboards.flatMap((dashboard) =>
      dashboard.sourceNodeGraph.nodes.map((node) => ({
        ...node,
        dashboardId: dashboard.id,
        dashboardTitle: dashboard.title,
      }))
    );
    return {
      result: {
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
        sources,
      },
    };
  }
}

function parseDashboardDraftPayload(
  payload: Record<string, unknown>,
  requireBundle: true,
): Pick<CreateCustomDashboardDraftInput, "manifest" | "fileBundle"> & Partial<CreateCustomDashboardDraftInput>;
function parseDashboardDraftPayload(
  payload: Record<string, unknown>,
  requireBundle: false,
): UpdateCustomDashboardDraftInput;
function parseDashboardDraftPayload(
  payload: Record<string, unknown>,
  requireBundle: boolean,
): (Pick<CreateCustomDashboardDraftInput, "manifest" | "fileBundle"> & Partial<CreateCustomDashboardDraftInput>) | UpdateCustomDashboardDraftInput {
  const title = parseOptionalString(payload, "title");
  const description = parseOptionalString(payload, "description");
  const manifest = requireBundle
    ? parseRequiredObject<CreateCustomDashboardDraftInput["manifest"]>(payload, "manifest")
    : parseOptionalObject<UpdateCustomDashboardDraftInput["manifest"]>(payload, "manifest");
  const fileBundle = requireBundle
    ? parseRequiredObject<CreateCustomDashboardDraftInput["fileBundle"]>(payload, "fileBundle")
    : parseOptionalObject<UpdateCustomDashboardDraftInput["fileBundle"]>(payload, "fileBundle");
  const sourceNodeGraph = parseOptionalObject<UpdateCustomDashboardDraftInput["sourceNodeGraph"]>(payload, "sourceNodeGraph");
  const credentialBindings = parseOptionalArray<UpdateCustomDashboardDraftInput["credentialBindings"]>(payload, "credentialBindings");
  const routes = parseOptionalArray<UpdateCustomDashboardDraftInput["routes"]>(payload, "routes");
  const styleguide = parseOptionalObject<UpdateCustomDashboardDraftInput["styleguide"]>(payload, "styleguide");
  const runtimeMetadata = parseOptionalObject<UpdateCustomDashboardDraftInput["runtimeMetadata"]>(payload, "runtimeMetadata");
  return {
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(manifest !== undefined ? { manifest } : {}),
    ...(fileBundle !== undefined ? { fileBundle } : {}),
    ...(sourceNodeGraph !== undefined ? { sourceNodeGraph } : {}),
    ...(credentialBindings !== undefined ? { credentialBindings } : {}),
    ...(routes !== undefined ? { routes } : {}),
    ...(styleguide !== undefined ? { styleguide } : {}),
    ...(runtimeMetadata !== undefined ? { runtimeMetadata } : {}),
  };
}

function parseRevisionPayload(payload: Record<string, unknown>): CreateCustomDashboardRevisionInput {
  const manifest = parseOptionalObject<CreateCustomDashboardRevisionInput["manifest"]>(payload, "manifest");
  const fileBundle = parseOptionalObject<CreateCustomDashboardRevisionInput["fileBundle"]>(payload, "fileBundle");
  const sourceNodeGraph = parseOptionalObject<CreateCustomDashboardRevisionInput["sourceNodeGraph"]>(payload, "sourceNodeGraph");
  const credentialBindings = parseOptionalArray<CreateCustomDashboardRevisionInput["credentialBindings"]>(payload, "credentialBindings");
  const routes = parseOptionalArray<CreateCustomDashboardRevisionInput["routes"]>(payload, "routes");
  const styleguide = parseOptionalObject<CreateCustomDashboardRevisionInput["styleguide"]>(payload, "styleguide");
  const runtimeMetadata = parseOptionalObject<CreateCustomDashboardRevisionInput["runtimeMetadata"]>(payload, "runtimeMetadata");
  return {
    ...(manifest !== undefined ? { manifest } : {}),
    ...(fileBundle !== undefined ? { fileBundle } : {}),
    ...(sourceNodeGraph !== undefined ? { sourceNodeGraph } : {}),
    ...(credentialBindings !== undefined ? { credentialBindings } : {}),
    ...(routes !== undefined ? { routes } : {}),
    ...(styleguide !== undefined ? { styleguide } : {}),
    ...(runtimeMetadata !== undefined ? { runtimeMetadata } : {}),
  };
}

function parseOptionalArray<T extends unknown[] | undefined>(
  payload: Record<string, unknown>,
  field: string,
): T {
  const value = payload[field];
  if (value === undefined || value === null) {
    return undefined as T;
  }
  if (!Array.isArray(value)) {
    throw managementValidationError(`${field} must be an array`, field);
  }
  return value as T;
}

function parseTail(payload: Record<string, unknown>): number | undefined {
  const raw = payload.tail;
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(value) || value < 1) {
    throw managementValidationError("tail must be a positive number", "tail");
  }
  return Math.min(5000, Math.floor(value));
}
