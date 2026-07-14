import type {
  AutomationCredentialCompatibilityAssessment,
  AutomationCredentialCompatibilityIssue,
  AutomationCredentialMetadata,
  CredentialBackendHealth,
} from "../contracts/automation-credential-types.js";
import type {
  CustomDashboardCredentialBinding,
  CustomDashboardCredentialSlotDeclaration,
  CustomDashboardRecord,
  CustomDashboardRevisionRecord,
  CustomDashboardValidationIssue,
  CustomDashboardValidationReport,
} from "../contracts/custom-dashboard-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import {
  CustomDashboardCredentialBindingConflictError,
  type CustomDashboardRepository,
} from "../repositories/custom-dashboard-repository.js";
import { EntityNotFoundError, ValidationError } from "../repositories/repository-utils.js";
import type { AutomationAuditExportService } from "./automation-audit-export-service.js";
import {
  CredentialAccessDeniedError,
  type CredentialBroker,
} from "./credentials/credential-broker.js";

const MAX_IDENTIFIER_LENGTH = 256;
const MAX_CREDENTIAL_CANDIDATES = 100;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const CREDENTIAL_BINDING_ID_REDACTION = "[REDACTED_CREDENTIAL_BINDING_ID]";
const CREDENTIAL_BINDING_PROPERTY_NAMES = new Set(["credentialbindings", "credentialid"]);

export interface CustomDashboardCredentialCandidate {
  credentialId: string;
  metadata: AutomationCredentialMetadata | null;
  compatible: boolean;
  issues: AutomationCredentialCompatibilityIssue[];
  missingCapabilities: string[];
}

export interface CustomDashboardCredentialSlotReview {
  slot: CustomDashboardCredentialSlotDeclaration;
  binding: CustomDashboardCredentialBinding | null;
  metadata: AutomationCredentialMetadata | null;
  compatible: boolean;
  issues: CustomDashboardValidationIssue[];
  candidates?: CustomDashboardCredentialCandidate[];
}

export interface CustomDashboardCredentialBindingReview {
  projectId: string;
  dashboardId: string;
  revisionId: string | null;
  credentialBindingRevision: number | null;
  backend: CredentialBackendHealth;
  valid: boolean;
  issues: CustomDashboardValidationIssue[];
  slots: CustomDashboardCredentialSlotReview[];
  credentialCandidateCount: number;
  credentialCandidatesTruncated: boolean;
}

export class CustomDashboardCredentialBindingValidationError extends ValidationError {
  readonly issues: CustomDashboardValidationIssue[];

  constructor(readonly review: CustomDashboardCredentialBindingReview) {
    const credentialIds = review.slots.flatMap((slot) => slot.binding ? [slot.binding.credentialId] : []);
    const issues = sanitizeCustomDashboardCredentialBindingIds(review.issues, credentialIds);
    super(issues[0]?.message ?? "Custom dashboard credential bindings are invalid.");
    this.name = "CustomDashboardCredentialBindingValidationError";
    this.issues = issues;
  }
}

interface BindingServiceDependencies {
  customDashboardRepository: CustomDashboardRepository;
  projectManagementRepository: ProjectManagementRepository;
  credentialBroker: CredentialBroker;
  auditService?: AutomationAuditExportService;
}

interface BindCredentialInput {
  slotId: string;
  credentialId: string;
  expectedBindingRevision: number;
}

interface UnbindCredentialInput {
  slotId: string;
  expectedBindingRevision: number;
}

export class CustomDashboardCredentialBindingService {
  constructor(private readonly deps: BindingServiceDependencies) {}

  async listCredentialSlots(
    projectIdValue: string,
    dashboardIdValue: string,
    revisionIdValue?: string,
  ): Promise<CustomDashboardCredentialBindingReview> {
    const projectId = boundedString(projectIdValue, "projectId");
    const dashboardId = boundedString(dashboardIdValue, "dashboardId");
    const dashboard = this.requireDashboard(projectId, dashboardId);
    const revisionId = revisionIdValue === undefined ? undefined : boundedString(revisionIdValue, "revisionId");
    const target = revisionId ? this.requireRevision(dashboard, revisionId) : dashboard;
    return await this.reviewTarget(dashboard, target, true);
  }

  async reviewRevision(
    projectIdValue: string,
    dashboardIdValue: string,
    revisionIdValue: string,
  ): Promise<CustomDashboardCredentialBindingReview> {
    const projectId = boundedString(projectIdValue, "projectId");
    const dashboardId = boundedString(dashboardIdValue, "dashboardId");
    const revisionId = boundedString(revisionIdValue, "revisionId");
    const dashboard = this.requireDashboard(projectId, dashboardId);
    return await this.reviewTarget(dashboard, this.requireRevision(dashboard, revisionId), false);
  }

  async requireValidRevision(
    projectId: string,
    dashboardId: string,
    revisionId: string,
  ): Promise<CustomDashboardCredentialBindingReview> {
    const review = await this.reviewRevision(projectId, dashboardId, revisionId);
    if (!review.valid) {
      throw new CustomDashboardCredentialBindingValidationError(review);
    }
    return review;
  }

  async bindCredential(
    projectIdValue: string,
    dashboardIdValue: string,
    inputValue: unknown,
  ): Promise<CustomDashboardCredentialBindingReview> {
    const projectId = boundedString(projectIdValue, "projectId");
    const dashboardId = boundedString(dashboardIdValue, "dashboardId");
    let slotId: string | null = null;
    let credentialId: string | null = null;
    let revision: number | null = null;
    try {
      const input = parseBindInput(inputValue);
      slotId = input.slotId;
      credentialId = input.credentialId;
      const dashboard = this.requireDashboard(projectId, dashboardId);
      revision = dashboard.credentialBindingRevision ?? 1;
      this.requireExpectedRevision(dashboard, input.expectedBindingRevision);
      const slot = this.requireSlot(dashboard, input.slotId);
      const assessment = await this.deps.credentialBroker.assessCompatibility(input.credentialId, {
        projectId,
        allowedKinds: slot.allowedKinds,
        requiredCapabilities: slot.requiredCapabilities,
      });
      if (!assessment.compatible) {
        const reason = issueMessage(slot, assessment.issues[0] ?? "not_configured", assessment.missingCapabilities);
        throw new CredentialAccessDeniedError(reason);
      }
      const bindings = replaceBinding(dashboard.credentialBindings ?? [], {
        slotId: input.slotId,
        credentialId: input.credentialId,
      });
      const updated = this.deps.customDashboardRepository.updateCredentialBindings(dashboard.id, {
        expectedBindingRevision: input.expectedBindingRevision,
        bindings,
      });
      revision = updated.credentialBindingRevision ?? input.expectedBindingRevision + 1;
      this.audit("custom_dashboard.credential.bind", projectId, dashboardId, revision, slotId, credentialId, "succeeded", null);
      return await this.reviewTarget(updated, updated, true);
    } catch (error) {
      this.audit(
        "custom_dashboard.credential.bind",
        projectId,
        dashboardId,
        revision,
        slotId,
        credentialId,
        bindingAuditOutcome(error),
        safeDenialReason(error),
      );
      throw error;
    }
  }

  async unbindCredential(
    projectIdValue: string,
    dashboardIdValue: string,
    inputValue: unknown,
  ): Promise<CustomDashboardCredentialBindingReview> {
    const projectId = boundedString(projectIdValue, "projectId");
    const dashboardId = boundedString(dashboardIdValue, "dashboardId");
    let slotId: string | null = null;
    let credentialId: string | null = null;
    let revision: number | null = null;
    try {
      const input = parseUnbindInput(inputValue);
      slotId = input.slotId;
      const dashboard = this.requireDashboard(projectId, dashboardId);
      revision = dashboard.credentialBindingRevision ?? 1;
      this.requireExpectedRevision(dashboard, input.expectedBindingRevision);
      this.requireSlot(dashboard, input.slotId);
      credentialId = dashboard.credentialBindings?.find((binding) => binding.slotId === input.slotId)?.credentialId ?? null;
      if (!credentialId) {
        this.audit("custom_dashboard.credential.unbind", projectId, dashboardId, revision, slotId, null, "succeeded", null);
        return await this.reviewTarget(dashboard, dashboard, true);
      }
      const updated = this.deps.customDashboardRepository.updateCredentialBindings(dashboard.id, {
        expectedBindingRevision: input.expectedBindingRevision,
        bindings: (dashboard.credentialBindings ?? []).filter((binding) => binding.slotId !== input.slotId),
      });
      revision = updated.credentialBindingRevision ?? input.expectedBindingRevision + 1;
      this.audit("custom_dashboard.credential.unbind", projectId, dashboardId, revision, slotId, credentialId, "succeeded", null);
      return await this.reviewTarget(updated, updated, true);
    } catch (error) {
      this.audit(
        "custom_dashboard.credential.unbind",
        projectId,
        dashboardId,
        revision,
        slotId,
        credentialId,
        bindingAuditOutcome(error),
        safeDenialReason(error),
      );
      throw error;
    }
  }

  toValidationReport(review: CustomDashboardCredentialBindingReview): CustomDashboardValidationReport {
    return {
      valid: review.valid,
      summary: review.valid
        ? "Custom dashboard credential bindings passed metadata-only policy review."
        : "Custom dashboard credential bindings did not pass metadata-only policy review.",
      issues: review.issues,
    };
  }

  private async reviewTarget(
    dashboard: CustomDashboardRecord,
    target: CustomDashboardRecord | CustomDashboardRevisionRecord,
    includeCandidates: boolean,
  ): Promise<CustomDashboardCredentialBindingReview> {
    const backend = await this.safeBackendHealth();
    const declarations = target.manifest.credentialSlots ?? [];
    const bindings = target.credentialBindings ?? [];
    const allMetadata = includeCandidates ? this.deps.credentialBroker.list(dashboard.projectId) : [];
    const metadata = allMetadata.slice(0, MAX_CREDENTIAL_CANDIDATES);
    const assessmentCache = new Map<string, Promise<AutomationCredentialCompatibilityAssessment>>();
    const assess = (
      credentialId: string,
      slot: CustomDashboardCredentialSlotDeclaration,
    ): Promise<AutomationCredentialCompatibilityAssessment> => {
      const key = `${credentialId}\u0000${slot.allowedKinds.join("\u0000")}\u0001${slot.requiredCapabilities.join("\u0000")}`;
      const cached = assessmentCache.get(key);
      if (cached) return cached;
      const pending = this.deps.credentialBroker.assessCompatibility(credentialId, {
        projectId: dashboard.projectId,
        allowedKinds: slot.allowedKinds,
        requiredCapabilities: slot.requiredCapabilities,
      });
      assessmentCache.set(key, pending);
      return pending;
    };

    const slots = await Promise.all(declarations.map(async (slot): Promise<CustomDashboardCredentialSlotReview> => {
      const binding = bindings.find((candidate) => candidate.slotId === slot.slotId) ?? null;
      const assessment = binding ? await assess(binding.credentialId, slot) : null;
      const issues = assessment
        ? assessment.issues.map((issue) => validationIssue(slot, issue, assessment.missingCapabilities))
        : slot.required
          ? [validationIssue(slot, "required_binding_missing", [])]
          : [];
      const candidates = includeCandidates
        ? await Promise.all(metadata.map(async (credential): Promise<CustomDashboardCredentialCandidate> => {
          const candidateAssessment = await assess(credential.id, slot);
          return {
            credentialId: credential.id,
            metadata: candidateAssessment.metadata,
            compatible: candidateAssessment.compatible,
            issues: candidateAssessment.issues,
            missingCapabilities: candidateAssessment.missingCapabilities,
          };
        }))
        : undefined;
      return {
        slot,
        binding,
        metadata: assessment?.metadata ?? null,
        compatible: issues.length === 0,
        issues,
        ...(candidates ? { candidates } : {}),
      };
    }));
    const issues = slots.flatMap((slot) => slot.issues);
    return {
      projectId: dashboard.projectId,
      dashboardId: dashboard.id,
      revisionId: "revisionNumber" in target ? target.id : null,
      credentialBindingRevision: "revisionNumber" in target ? null : target.credentialBindingRevision ?? 1,
      backend,
      valid: issues.length === 0,
      issues,
      slots,
      credentialCandidateCount: allMetadata.length,
      credentialCandidatesTruncated: allMetadata.length > metadata.length,
    };
  }

  private requireDashboard(projectId: string, dashboardId: string): CustomDashboardRecord {
    if (!this.deps.projectManagementRepository.getProject(projectId)) {
      throw new EntityNotFoundError(`Project not found: ${projectId}`);
    }
    const dashboard = this.deps.customDashboardRepository.getDashboardById(dashboardId);
    if (!dashboard || dashboard.projectId !== projectId) {
      throw new EntityNotFoundError(`Custom dashboard not found: ${dashboardId}`);
    }
    return dashboard;
  }

  private requireRevision(dashboard: CustomDashboardRecord, revisionId: string): CustomDashboardRevisionRecord {
    const revision = this.deps.customDashboardRepository.getRevisionById(revisionId);
    if (!revision || revision.dashboardId !== dashboard.id || revision.projectId !== dashboard.projectId) {
      throw new EntityNotFoundError(`Custom dashboard revision not found: ${revisionId}`);
    }
    return revision;
  }

  private requireSlot(
    dashboard: CustomDashboardRecord,
    slotId: string,
  ): CustomDashboardCredentialSlotDeclaration {
    const slot = dashboard.manifest.credentialSlots?.find((candidate) => candidate.slotId === slotId);
    if (!slot) {
      throw new ValidationError(`Custom dashboard credential slot is not declared: ${slotId}`);
    }
    return slot;
  }

  private requireExpectedRevision(dashboard: CustomDashboardRecord, expected: number): void {
    const actual = dashboard.credentialBindingRevision ?? 1;
    if (actual !== expected) {
      throw new CustomDashboardCredentialBindingConflictError(dashboard.id, expected, actual);
    }
  }

  private async safeBackendHealth(): Promise<CredentialBackendHealth> {
    try {
      return await this.deps.credentialBroker.health();
    } catch {
      return {
        available: false,
        secure: false,
        provider: "unavailable",
        keyId: null,
        keyVersion: null,
        reason: "Credential key provider health check failed.",
      };
    }
  }

  private audit(
    action: string,
    projectId: string,
    dashboardId: string,
    revision: number | null,
    slotId: string | null,
    credentialId: string | null,
    outcome: "succeeded" | "denied" | "failed",
    denialReason: string | null,
  ): void {
    try {
      this.deps.auditService?.recordSystem({
        action,
        resourceType: "custom_dashboard_credential_binding",
        resourceId: dashboardId,
        projectId,
        outcome,
        metadata: { dashboardId, revision, slotId, credentialId, denialReason },
      });
    } catch {
      // Binding policy decisions must not depend on audit-store availability.
    }
  }
}

export function withoutCustomDashboardCredentialBindings(
  dashboard: CustomDashboardRecord,
  additionalCredentialIds: Iterable<string> = [],
): Omit<CustomDashboardRecord, "credentialBindings"> {
  const credentialIds = customDashboardCredentialBindingIds(dashboard, additionalCredentialIds);
  const sanitized = sanitizeCustomDashboardCredentialBindingIds(dashboard, credentialIds);
  const { credentialBindings: _credentialBindings, ...safe } = sanitized;
  return safe;
}

export function withoutCustomDashboardRevisionCredentialBindings(
  revision: CustomDashboardRevisionRecord,
  additionalCredentialIds: Iterable<string> = [],
): Omit<CustomDashboardRevisionRecord, "credentialBindings"> {
  const credentialIds = customDashboardCredentialBindingIds(revision, additionalCredentialIds);
  const sanitized = sanitizeCustomDashboardCredentialBindingIds(revision, credentialIds);
  const { credentialBindings: _credentialBindings, ...safe } = sanitized;
  return safe;
}

export function collectCustomDashboardCredentialBindingIds(
  records: Iterable<CustomDashboardRecord | CustomDashboardRevisionRecord>,
): string[] {
  const credentialIds = new Set<string>();
  for (const record of records) {
    for (const binding of record.credentialBindings ?? []) {
      if (binding.credentialId) credentialIds.add(binding.credentialId);
    }
  }
  return [...credentialIds];
}

export function sanitizeCustomDashboardCredentialBindingIds<T>(
  value: T,
  credentialIds: Iterable<string>,
): T {
  const identifiers = [...new Set(credentialIds)]
    .filter((credentialId) => credentialId.length > 0)
    .sort((left, right) => right.length - left.length);
  return sanitizeCredentialBindingValue(value, identifiers) as T;
}

function customDashboardCredentialBindingIds(
  record: CustomDashboardRecord | CustomDashboardRevisionRecord,
  additionalCredentialIds: Iterable<string>,
): string[] {
  return collectCustomDashboardCredentialBindingIds([record])
    .concat([...additionalCredentialIds]);
}

function sanitizeCredentialBindingValue(value: unknown, credentialIds: readonly string[]): unknown {
  if (typeof value === "string") {
    return credentialIds.reduce(
      (safe, credentialId) => safe.split(credentialId).join(CREDENTIAL_BINDING_ID_REDACTION),
      value,
    );
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeCredentialBindingValue(entry, credentialIds));
  }
  if (!value || typeof value !== "object") return value;

  const safe: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (CREDENTIAL_BINDING_PROPERTY_NAMES.has(normalizedKey)
      || credentialIds.some((credentialId) => key.includes(credentialId))) {
      continue;
    }
    safe[key] = sanitizeCredentialBindingValue(entry, credentialIds);
  }
  return safe;
}

function parseBindInput(value: unknown): BindCredentialInput {
  const input = requireObject(value, "custom dashboard credential binding");
  rejectUnknownFields(input, ["slotId", "credentialId", "expectedBindingRevision"]);
  return {
    slotId: boundedString(input.slotId, "slotId"),
    credentialId: boundedString(input.credentialId, "credentialId"),
    expectedBindingRevision: positiveInteger(input.expectedBindingRevision, "expectedBindingRevision"),
  };
}

function parseUnbindInput(value: unknown): UnbindCredentialInput {
  const input = requireObject(value, "custom dashboard credential unbinding");
  rejectUnknownFields(input, ["slotId", "expectedBindingRevision"]);
  return {
    slotId: boundedString(input.slotId, "slotId"),
    expectedBindingRevision: positiveInteger(input.expectedBindingRevision, "expectedBindingRevision"),
  };
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownFields(input: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError(`Custom dashboard credential binding contains unsupported fields: ${unknown.sort().join(", ")}.`);
  }
}

function boundedString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new ValidationError(`${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new ValidationError(`${label} is required.`);
  if (normalized.length > MAX_IDENTIFIER_LENGTH) throw new ValidationError(`${label} must be at most ${MAX_IDENTIFIER_LENGTH} characters.`);
  if (CONTROL_CHARACTERS.test(normalized)) throw new ValidationError(`${label} cannot contain control characters.`);
  return normalized;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new ValidationError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function replaceBinding(
  bindings: CustomDashboardCredentialBinding[],
  next: CustomDashboardCredentialBinding,
): CustomDashboardCredentialBinding[] {
  return [...bindings.filter((binding) => binding.slotId !== next.slotId), next]
    .sort((left, right) => left.slotId.localeCompare(right.slotId));
}

function validationIssue(
  slot: CustomDashboardCredentialSlotDeclaration,
  issue: AutomationCredentialCompatibilityIssue | "required_binding_missing",
  missingCapabilities: string[],
): CustomDashboardValidationIssue {
  return {
    field: `credentialBindings.${slot.slotId}`,
    code: issue,
    message: issueMessage(slot, issue, missingCapabilities),
  };
}

function issueMessage(
  slot: CustomDashboardCredentialSlotDeclaration,
  issue: AutomationCredentialCompatibilityIssue | "required_binding_missing",
  missingCapabilities: string[],
): string {
  const prefix = `Credential slot ${slot.slotId}`;
  switch (issue) {
    case "required_binding_missing": return `${prefix} requires a binding.`;
    case "backend_unavailable": return `${prefix} is unavailable because secure credential-key custody is not ready.`;
    case "backend_insecure": return `${prefix} is unavailable because credential-key custody is not secure.`;
    case "not_configured": return `${prefix} is bound to a credential that is not configured.`;
    case "not_active": return `${prefix} is bound to a credential that is not active.`;
    case "project_access_denied": return `${prefix} is bound to a credential that is inaccessible to this project.`;
    case "kind_not_allowed": return `${prefix} is bound to a credential kind that its declaration does not allow.`;
    case "capability_missing": return missingCapabilities.length > 0
      ? `${prefix} is missing required capabilities: ${missingCapabilities.join(", ")}.`
      : `${prefix} is missing one or more required capabilities.`;
  }
}

function safeDenialReason(error: unknown): string {
  if (error instanceof CredentialAccessDeniedError) return error.message;
  if (error instanceof CustomDashboardCredentialBindingConflictError) return "credential_binding_revision_conflict";
  if (error instanceof EntityNotFoundError) return "resource_not_found";
  if (error instanceof ValidationError) return "validation_failed";
  return "operation_failed";
}

function bindingAuditOutcome(error: unknown): "denied" | "failed" {
  return error instanceof CredentialAccessDeniedError || error instanceof EntityNotFoundError
    ? "denied"
    : "failed";
}
