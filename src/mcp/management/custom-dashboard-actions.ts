import type {
  CreateCustomDashboardDraftInput,
  CreateCustomDashboardRevisionInput,
  CustomDashboardDataSourceNode,
  UpdateCustomDashboardDraftInput,
} from "../../contracts/custom-dashboard-types.js";
import type {
  ManageCodeUxArgs,
  ManageCustomDashboardsArgs,
  ManagementResponseEnvelope,
} from "../../contracts/internal-management-types.js";
import type { CustomDashboardRepository } from "../../repositories/custom-dashboard-repository.js";
import type { CustomDashboardValidationService } from "../../services/custom-dashboard-validation-service.js";
import {
  collectCustomDashboardCredentialBindingIds,
  CustomDashboardCredentialBindingValidationError,
  type CustomDashboardCredentialBindingService,
  withoutCustomDashboardCredentialBindings,
  withoutCustomDashboardRevisionCredentialBindings,
} from "../../services/custom-dashboard-credential-binding-service.js";
import {
  managementValidationError,
  parseOptionalObject,
  parseOptionalString,
  parseRequiredObject,
  parseRequiredString,
} from "./payload-parsers.js";

const BIND_CREDENTIAL_ARGUMENT_KEYS = new Set([
  "action",
  "projectId",
  "dashboardId",
  "slotId",
  "credentialId",
  "expectedBindingRevision",
  "approval",
]);
const UNBIND_CREDENTIAL_ARGUMENT_KEYS = new Set([
  "action",
  "projectId",
  "dashboardId",
  "slotId",
  "expectedBindingRevision",
  "approval",
]);

export function normalizeCustomDashboardCredentialMutationArgs(
  args: ManageCustomDashboardsArgs,
): ManageCustomDashboardsArgs {
  if (args.action !== "bind_credential" && args.action !== "unbind_credential") return args;

  const payload = args as unknown as Record<string, unknown>;
  const allowedKeys = args.action === "bind_credential"
    ? BIND_CREDENTIAL_ARGUMENT_KEYS
    : UNBIND_CREDENTIAL_ARGUMENT_KEYS;
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw managementValidationError(
      `${args.action} contains unsupported or secret-bearing fields`,
      "payload",
    );
  }

  const expectedBindingRevision = payload.expectedBindingRevision;
  if (typeof expectedBindingRevision !== "number"
    || !Number.isSafeInteger(expectedBindingRevision)
    || expectedBindingRevision < 1) {
    throw managementValidationError(
      "expectedBindingRevision must be a positive safe integer",
      "expectedBindingRevision",
    );
  }

  const approval = normalizeCredentialMutationApproval(payload.approval, args.action);
  const normalized: ManageCustomDashboardsArgs = {
    action: args.action,
    projectId: parseRequiredString(payload, "projectId"),
    dashboardId: parseRequiredString(payload, "dashboardId"),
    slotId: parseRequiredString(payload, "slotId"),
    expectedBindingRevision,
    ...(approval ? { approval } : {}),
  };
  if (args.action === "bind_credential") {
    normalized.credentialId = parseRequiredString(payload, "credentialId");
  }
  return normalized;
}

function normalizeCredentialMutationApproval(
  value: unknown,
  action: "bind_credential" | "unbind_credential",
): ManageCustomDashboardsArgs["approval"] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw managementValidationError(`${action} approval must be an object`, "approval");
  }
  const approval = value as Record<string, unknown>;
  if (Object.keys(approval).some((key) => key !== "confirmed")
    || typeof approval.confirmed !== "boolean") {
    throw managementValidationError(
      `${action} approval accepts only a boolean confirmed field`,
      "approval",
    );
  }
  return { confirmed: approval.confirmed };
}

export class CustomDashboardActions {
  constructor(
    private readonly customDashboardRepository: CustomDashboardRepository,
    private readonly customDashboardCredentialBindingService: CustomDashboardCredentialBindingService,
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
      case "list_credential_slots":
        return await this.listCredentialSlots(payload);
      case "bind_credential":
        return await this.bindCredential(args, payload);
      case "unbind_credential":
        return await this.unbindCredential(args, payload);
      default:
        throw managementValidationError(`Unknown custom dashboard action: ${args.action}`, "action");
    }
  }

  private listDashboards(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    return {
      result: {
        dashboards: this.customDashboardRepository.listDashboardsByProject(projectId)
          .map((dashboard) => withoutCustomDashboardCredentialBindings(dashboard)),
      },
    };
  }

  private getDashboard(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const dashboardId = parseRequiredString(payload, "dashboardId");
    const dashboard = this.customDashboardRepository.getDashboardById(dashboardId);
    if (!dashboard) {
      throw managementValidationError(`Custom dashboard not found: ${dashboardId}`, "dashboardId");
    }
    const revisions = this.customDashboardRepository.listRevisions(dashboard.id);
    const credentialIds = collectCustomDashboardCredentialBindingIds([dashboard, ...revisions]);
    return {
      result: {
        dashboard: withoutCustomDashboardCredentialBindings(dashboard, credentialIds),
        revisions: revisions.map((revision) =>
          withoutCustomDashboardRevisionCredentialBindings(revision, credentialIds)),
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
      styleguide: draft.styleguide,
      runtimeMetadata: draft.runtimeMetadata,
    });
    return { result: { dashboard: withoutCustomDashboardCredentialBindings(dashboard) } };
  }

  private updateDashboard(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const dashboardId = parseRequiredString(payload, "dashboardId");
    const dashboard = this.customDashboardRepository.updateDraft(
      dashboardId,
      parseDashboardDraftPayload(payload, false),
    );
    return { result: { dashboard: withoutCustomDashboardCredentialBindings(dashboard) } };
  }

  private createRevision(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const dashboardId = parseRequiredString(payload, "dashboardId");
    const revision = this.customDashboardRepository.createRevision(
      dashboardId,
      parseRevisionPayload(payload),
    );
    return { result: { revision: withoutCustomDashboardRevisionCredentialBindings(revision) } };
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

  private async publishRevision(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const dashboardId = parseRequiredString(payload, "dashboardId");
    const revisionId = parseRequiredString(payload, "revisionId");
    const dashboardRecord = this.customDashboardRepository.getDashboardById(dashboardId);
    if (!dashboardRecord) {
      throw managementValidationError(`Custom dashboard not found: ${dashboardId}`, "dashboardId");
    }
    try {
      await this.customDashboardCredentialBindingService.requireValidRevision(
        dashboardRecord.projectId,
        dashboardId,
        revisionId,
      );
    } catch (error) {
      if (error instanceof CustomDashboardCredentialBindingValidationError) {
        throw managementValidationError(error.message, undefined, error.issues);
      }
      throw error;
    }
    const dashboard = this.customDashboardRepository.publishRevision(
      dashboardId,
      revisionId,
      parseOptionalString(payload, "validationSessionId"),
    );
    return { result: { dashboard: withoutCustomDashboardCredentialBindings(dashboard) } };
  }

  private archiveDashboard(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const dashboardId = parseRequiredString(payload, "dashboardId");
    if (args.approval?.confirmed !== true) {
      return {
        approvalRequired: true,
        approvalMessage: `Archiving custom dashboard ${dashboardId} removes its active publication. Call again with approval.confirmed true after human approval.`,
      };
    }
    return {
      result: {
        dashboard: withoutCustomDashboardCredentialBindings(
          this.customDashboardRepository.archiveDashboard(dashboardId),
        ),
      },
    };
  }

  private dataCatalog(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const dashboards = this.customDashboardRepository.listDashboardsByProject(projectId)
      .map((dashboard) => withoutCustomDashboardCredentialBindings(dashboard));
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
        })),
        sources,
      },
    };
  }

  private async listCredentialSlots(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const projectId = parseRequiredString(payload, "projectId");
    const dashboardId = parseRequiredString(payload, "dashboardId");
    const revisionId = parseOptionalString(payload, "revisionId");
    return {
      result: {
        bindings: await this.customDashboardCredentialBindingService.listCredentialSlots(
          projectId,
          dashboardId,
          revisionId,
        ),
      },
    };
  }

  private async bindCredential(
    args: ManageCodeUxArgs,
    payload: Record<string, unknown>,
  ): Promise<ManagementResponseEnvelope> {
    const dashboardId = parseRequiredString(payload, "dashboardId");
    if (args.approval?.confirmed !== true) {
      return {
        approvalRequired: true,
        approvalMessage: `Binding a credential to custom dashboard ${dashboardId} requires human approval. Review the metadata-only slot selection and call again with approval.confirmed true.`,
      };
    }
    return {
      result: {
        bindings: await this.customDashboardCredentialBindingService.bindCredential(
          parseRequiredString(payload, "projectId"),
          dashboardId,
          bindingMutationInput(payload, false),
        ),
      },
    };
  }

  private async unbindCredential(
    args: ManageCodeUxArgs,
    payload: Record<string, unknown>,
  ): Promise<ManagementResponseEnvelope> {
    const dashboardId = parseRequiredString(payload, "dashboardId");
    if (args.approval?.confirmed !== true) {
      return {
        approvalRequired: true,
        approvalMessage: `Unbinding a credential from custom dashboard ${dashboardId} requires human approval. Review the affected slot and call again with approval.confirmed true.`,
      };
    }
    return {
      result: {
        bindings: await this.customDashboardCredentialBindingService.unbindCredential(
          parseRequiredString(payload, "projectId"),
          dashboardId,
          bindingMutationInput(payload, true),
        ),
      },
    };
  }
}

function bindingMutationInput(payload: Record<string, unknown>, unbind: boolean): Record<string, unknown> {
  return {
    slotId: payload.slotId,
    expectedBindingRevision: payload.expectedBindingRevision,
    ...(unbind ? {} : { credentialId: payload.credentialId }),
  };
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
  const styleguide = parseOptionalObject<UpdateCustomDashboardDraftInput["styleguide"]>(payload, "styleguide");
  const runtimeMetadata = parseOptionalObject<UpdateCustomDashboardDraftInput["runtimeMetadata"]>(payload, "runtimeMetadata");
  return {
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(manifest !== undefined ? { manifest } : {}),
    ...(fileBundle !== undefined ? { fileBundle } : {}),
    ...(sourceNodeGraph !== undefined ? { sourceNodeGraph } : {}),
    ...(styleguide !== undefined ? { styleguide } : {}),
    ...(runtimeMetadata !== undefined ? { runtimeMetadata } : {}),
  };
}

function parseRevisionPayload(payload: Record<string, unknown>): CreateCustomDashboardRevisionInput {
  const manifest = parseOptionalObject<CreateCustomDashboardRevisionInput["manifest"]>(payload, "manifest");
  const fileBundle = parseOptionalObject<CreateCustomDashboardRevisionInput["fileBundle"]>(payload, "fileBundle");
  const sourceNodeGraph = parseOptionalObject<CreateCustomDashboardRevisionInput["sourceNodeGraph"]>(payload, "sourceNodeGraph");
  const styleguide = parseOptionalObject<CreateCustomDashboardRevisionInput["styleguide"]>(payload, "styleguide");
  const runtimeMetadata = parseOptionalObject<CreateCustomDashboardRevisionInput["runtimeMetadata"]>(payload, "runtimeMetadata");
  return {
    ...(manifest !== undefined ? { manifest } : {}),
    ...(fileBundle !== undefined ? { fileBundle } : {}),
    ...(sourceNodeGraph !== undefined ? { sourceNodeGraph } : {}),
    ...(styleguide !== undefined ? { styleguide } : {}),
    ...(runtimeMetadata !== undefined ? { runtimeMetadata } : {}),
  };
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
