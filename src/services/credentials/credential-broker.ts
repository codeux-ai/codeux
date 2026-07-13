import { randomUUID } from "node:crypto";
import type {
  AutomationCredentialBinding,
  AutomationCredentialCompatibilityAssessment,
  AutomationCredentialCompatibilityInput,
  AutomationCredentialCompatibilityIssue,
  AutomationCredentialMetadata,
  BindAutomationCredentialInput,
  CreateAutomationCredentialInput,
  CredentialBackendHealth,
  CredentialResolutionRequest,
  PromoteAutomationCredentialInput,
  ReplaceAutomationCredentialSecretInput,
  ResolvedCredential,
  RestrictAutomationCredentialInput,
  RevokeAutomationCredentialInput,
  TestAutomationCredentialInput,
  UpdateAutomationCredentialMetadataInput,
} from "../../contracts/automation-credential-types.js";
import {
  CredentialConcurrentModificationError,
  type AutomationCredentialRepository,
} from "../../repositories/automation-credential-repository.js";
import { ValidationError } from "../../repositories/repository-utils.js";
import type { AutomationAuditExportService } from "../automation-audit-export-service.js";
import type { KeyProvider } from "./key-provider.js";
import { KeyProviderUnavailableError } from "./key-provider.js";
import type { SecretContext, SecretStore } from "./secret-store.js";

const MAX_NAME_LENGTH = 128;
const MAX_KIND_LENGTH = 128;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_CAPABILITY_LENGTH = 128;
const MAX_LIST_ITEMS = 128;
const MAX_SECRET_BYTES = 64 * 1024;
const MAX_RESOLUTION_RETRIES = 3;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const CREDENTIAL_KIND = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;

export class CredentialAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialAccessDeniedError";
  }
}

export class CredentialKeyCustodyUnavailableError extends Error {
  constructor(message = "Credential key custody is unavailable; restore the configured secure key provider and retry.") {
    super(message);
    this.name = "CredentialKeyCustodyUnavailableError";
  }
}

export class CredentialEncryptedStateError extends Error {
  constructor(message = "The credential's encrypted state is invalid or unavailable; replace its value with the current version before retrying.") {
    super(message);
    this.name = "CredentialEncryptedStateError";
  }
}

function boundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new ValidationError(`${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new ValidationError(`${label} is required.`);
  if (normalized.length > maxLength) throw new ValidationError(`${label} must be at most ${maxLength} characters.`);
  if (CONTROL_CHARACTERS.test(normalized)) throw new ValidationError(`${label} cannot contain control characters.`);
  return normalized;
}

function boundedList(value: unknown, label: string, itemMaxLength: number): string[] {
  if (!Array.isArray(value)) throw new ValidationError(`${label} must be an explicit array of strings.`);
  if (value.length > MAX_LIST_ITEMS) throw new ValidationError(`${label} cannot contain more than ${MAX_LIST_ITEMS} entries.`);
  const normalized = value.map((item) => boundedString(item, `${label} entry`, itemMaxLength));
  return [...new Set(normalized)];
}

function expectedVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new ValidationError("expectedVersion must be a positive safe integer.");
  }
  return value;
}

function secretValue(value: unknown, label = "value"): string {
  if (typeof value !== "string" || value.length === 0) throw new ValidationError(`A non-empty ${label} is required.`);
  if (Buffer.byteLength(value, "utf8") > MAX_SECRET_BYTES) throw new ValidationError(`${label} must be at most ${MAX_SECRET_BYTES} UTF-8 bytes.`);
  return value;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function rejectUnknownFields(input: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new ValidationError(`${label} contains unsupported fields: ${unknown.sort().join(", ")}.`);
}

function sameCredentialSnapshot(left: AutomationCredentialMetadata, right: AutomationCredentialMetadata): boolean {
  return left.id === right.id
    && left.version === right.version
    && left.status === right.status
    && left.scope === right.scope
    && left.projectId === right.projectId
    && left.managementProjectId === right.managementProjectId
    && left.allowedProjectIds.length === right.allowedProjectIds.length
    && left.allowedProjectIds.every((projectId, index) => projectId === right.allowedProjectIds[index])
    && left.capabilities.length === right.capabilities.length
    && left.capabilities.every((capability, index) => capability === right.capabilities[index]);
}

function hasBackendIdentity(health: CredentialBackendHealth): boolean {
  return typeof health.keyId === "string" && health.keyId.length > 0 && health.keyVersion !== null;
}

function isBackendReady(health: CredentialBackendHealth): boolean {
  return health.available && health.secure && hasBackendIdentity(health);
}

export class CredentialBroker {
  constructor(
    private readonly repository: AutomationCredentialRepository,
    private readonly secretStore: SecretStore,
    private readonly keyProvider: KeyProvider,
    private readonly auditService?: AutomationAuditExportService,
  ) {}

  health(): Promise<CredentialBackendHealth> {
    return this.keyProvider.health();
  }

  list(projectId: string): AutomationCredentialMetadata[] {
    return this.repository.list(boundedString(projectId, "projectId", MAX_IDENTIFIER_LENGTH));
  }

  async create(projectIdValue: string, inputValue: CreateAutomationCredentialInput): Promise<AutomationCredentialMetadata> {
    const projectId = boundedString(projectIdValue, "projectId", MAX_IDENTIFIER_LENGTH);
    let credentialId: string | null = null;
    try {
      this.repository.requireProject(projectId);
      const input = requireObject(inputValue, "credential") as unknown as CreateAutomationCredentialInput & Record<string, unknown>;
      rejectUnknownFields(input, ["name", "kind", "value", "scope", "allowedProjectIds", "capabilities"], "credential");
      const name = boundedString(input.name, "name", MAX_NAME_LENGTH);
      const kind = boundedString(input.kind, "kind", MAX_KIND_LENGTH);
      if (!CREDENTIAL_KIND.test(kind)) throw new ValidationError("kind may contain only letters, numbers, dots, underscores, colons, and hyphens.");
      const value = secretValue(input.value);
      const scope = input.scope;
      if (scope !== "project" && scope !== "global") throw new ValidationError("scope must be explicitly set to project or global.");
      const requestedProjects = boundedList(input.allowedProjectIds, "allowedProjectIds", MAX_IDENTIFIER_LENGTH);
      if (scope === "project" && requestedProjects.length > 0) {
        throw new ValidationError("Project credentials must use an empty allowedProjectIds array.");
      }
      if (scope === "global" && !requestedProjects.includes(projectId)) {
        throw new ValidationError("Global credentials require an explicit allowlist containing the configuring project.");
      }
      const allowedProjectIds = scope === "global"
        ? [projectId, ...requestedProjects.filter((candidate) => candidate !== projectId)]
        : [];
      for (const allowedProjectId of allowedProjectIds) this.repository.requireProject(allowedProjectId);
      const capabilities = boundedList(input.capabilities, "capabilities", MAX_CAPABILITY_LENGTH);
      await this.requireBackendReady();
      credentialId = randomUUID();
      const plaintext = Buffer.from(value, "utf8");
      try {
        const envelope = await this.secretStore.seal(this.contextFor(credentialId, scope === "project" ? projectId : null), plaintext);
        const created = this.repository.createWithEnvelope({
          id: credentialId,
          name,
          kind,
          scope,
          projectId: scope === "project" ? projectId : null,
          managementProjectId: projectId,
          allowedProjectIds,
          capabilities,
        }, envelope);
        this.auditLifecycle("credential.create", projectId, created, "succeeded");
        return created;
      } finally {
        plaintext.fill(0);
      }
    } catch (error) {
      this.auditLifecycleFailure("credential.create", projectId, credentialId, error);
      throw this.normalizeCustodyError(error);
    }
  }

  updateMetadata(projectIdValue: string, credentialIdValue: string, inputValue: UpdateAutomationCredentialMetadataInput): AutomationCredentialMetadata {
    const projectId = boundedString(projectIdValue, "projectId", MAX_IDENTIFIER_LENGTH);
    const credentialId = boundedString(credentialIdValue, "credentialId", MAX_IDENTIFIER_LENGTH);
    try {
      const input = requireObject(inputValue, "metadata update");
      rejectUnknownFields(input, ["name", "expectedVersion"], "metadata update");
      const credential = this.requireManageable(projectId, credentialId);
      this.requireExpectedVersion(credential, expectedVersion(input.expectedVersion));
      const updated = this.repository.updateMetadata({
        credentialId,
        expectedVersion: credential.version,
        name: boundedString(input.name, "name", MAX_NAME_LENGTH),
      });
      this.auditLifecycle("credential.update", projectId, updated, "succeeded");
      return updated;
    } catch (error) {
      this.auditLifecycleFailure("credential.update", projectId, credentialId, error);
      throw error;
    }
  }

  bind(projectIdValue: string, credentialIdValue: string, inputValue: BindAutomationCredentialInput): AutomationCredentialBinding {
    const projectId = boundedString(projectIdValue, "projectId", MAX_IDENTIFIER_LENGTH);
    const credentialId = boundedString(credentialIdValue, "credentialId", MAX_IDENTIFIER_LENGTH);
    try {
      const input = requireObject(inputValue, "binding");
      rejectUnknownFields(input, ["bindingKey", "requiredCapabilities"], "binding");
      const bindingKey = boundedString(input.bindingKey, "bindingKey", MAX_IDENTIFIER_LENGTH);
      const credential = this.requireAccessible(projectId, credentialId);
      if (credential.status !== "active") throw new CredentialAccessDeniedError("Only active credentials can be bound.");
      const required = boundedList(input.requiredCapabilities, "requiredCapabilities", MAX_CAPABILITY_LENGTH);
      if (required.some((capability) => !credential.capabilities.includes(capability))) {
        throw new CredentialAccessDeniedError("Binding requests capabilities the credential does not grant.");
      }
      const binding = this.repository.bind(credentialId, projectId, bindingKey, required);
      this.auditLifecycle("credential.bind", projectId, credential, "succeeded");
      return binding;
    } catch (error) {
      this.auditLifecycleFailure("credential.bind", projectId, credentialId, error);
      throw error;
    }
  }

  async assessCompatibility(credentialIdValue: string, inputValue: AutomationCredentialCompatibilityInput): Promise<AutomationCredentialCompatibilityAssessment> {
    const credentialId = boundedString(credentialIdValue, "credentialId", MAX_IDENTIFIER_LENGTH);
    const input = requireObject(inputValue, "compatibility assessment");
    rejectUnknownFields(input, ["projectId", "allowedKinds", "requiredCapabilities"], "compatibility assessment");
    const projectId = boundedString(input.projectId, "projectId", MAX_IDENTIFIER_LENGTH);
    this.repository.requireProject(projectId);
    const allowedKinds = boundedList(input.allowedKinds, "allowedKinds", MAX_KIND_LENGTH);
    if (allowedKinds.length === 0) throw new ValidationError("allowedKinds must declare at least one permitted credential kind.");
    const requiredCapabilities = boundedList(input.requiredCapabilities, "requiredCapabilities", MAX_CAPABILITY_LENGTH);
    const health = await this.safeHealth();
    const credential = this.repository.get(credentialId);
    const projectAccess = credential !== null && this.canAccess(credential, projectId);
    const configured = projectAccess && credential.configured;
    const active = projectAccess && credential.status === "active";
    const kindAllowed = projectAccess && allowedKinds.includes(credential.kind);
    const missingCapabilities = projectAccess
      ? requiredCapabilities.filter((capability) => !credential.capabilities.includes(capability))
      : [...requiredCapabilities];
    const capabilitiesAllowed = projectAccess && missingCapabilities.length === 0;
    const issues: AutomationCredentialCompatibilityIssue[] = [];
    const backendReady = isBackendReady(health);
    if (!health.available || !hasBackendIdentity(health)) issues.push("backend_unavailable");
    else if (!health.secure) issues.push("backend_insecure");
    if (!configured) issues.push("not_configured");
    if (!active) issues.push("not_active");
    if (!projectAccess) issues.push("project_access_denied");
    if (!kindAllowed) issues.push("kind_not_allowed");
    if (!capabilitiesAllowed) issues.push("capability_missing");
    return {
      credentialId,
      projectId,
      compatible: issues.length === 0,
      backendReady,
      configured,
      active,
      projectAccess,
      kindAllowed,
      capabilitiesAllowed,
      missingCapabilities,
      issues,
      metadata: projectAccess ? credential : null,
    };
  }

  async test(projectIdValue: string, credentialIdValue: string, inputValue: TestAutomationCredentialInput): Promise<AutomationCredentialMetadata> {
    const projectId = boundedString(projectIdValue, "projectId", MAX_IDENTIFIER_LENGTH);
    const credentialId = boundedString(credentialIdValue, "credentialId", MAX_IDENTIFIER_LENGTH);
    try {
      const input = requireObject(inputValue, "test request");
      rejectUnknownFields(input, ["expectedVersion"], "test request");
      const credential = this.requireManageable(projectId, credentialId);
      this.requireExpectedVersion(credential, expectedVersion(input.expectedVersion));
      if (credential.status !== "active") throw new CredentialAccessDeniedError("Only active credentials can be tested.");
      let plaintext: Buffer | null = null;
      try {
        plaintext = await this.secretStore.get(this.context(credential));
        const current = this.repository.get(credentialId);
        if (!current || !sameCredentialSnapshot(credential, current) || !this.canAccess(current, projectId) || current.status !== "active") {
          throw new CredentialAccessDeniedError("Credential changed while it was being tested; refresh its metadata and retry.");
        }
        const updated = this.repository.updateValidation({ credentialId, expectedVersion: credential.version, status: "valid" });
        this.auditLifecycle("credential.test", projectId, updated, "succeeded");
        return updated;
      } catch (error) {
        if (error instanceof CredentialAccessDeniedError || (error instanceof Error && error.name === "CredentialConcurrentModificationError")) throw error;
        const normalized = await this.classifyEncryptedStateError(error);
        const status = normalized instanceof CredentialKeyCustodyUnavailableError ? "unavailable" : "invalid";
        this.repository.updateValidation({ credentialId, expectedVersion: credential.version, status });
        throw normalized;
      } finally {
        plaintext?.fill(0);
      }
    } catch (error) {
      this.auditLifecycleFailure("credential.test", projectId, credentialId, error);
      throw error;
    }
  }

  async rotate(projectId: string, credentialId: string, input: ReplaceAutomationCredentialSecretInput): Promise<AutomationCredentialMetadata> {
    return this.replaceValue(projectId, credentialId, input, true);
  }

  async replace(projectId: string, credentialId: string, input: ReplaceAutomationCredentialSecretInput): Promise<AutomationCredentialMetadata> {
    return this.replaceValue(projectId, credentialId, input, false);
  }

  revoke(projectIdValue: string, credentialIdValue: string, inputValue: RevokeAutomationCredentialInput): AutomationCredentialMetadata {
    const projectId = boundedString(projectIdValue, "projectId", MAX_IDENTIFIER_LENGTH);
    const credentialId = boundedString(credentialIdValue, "credentialId", MAX_IDENTIFIER_LENGTH);
    try {
      const input = requireObject(inputValue, "revoke request");
      rejectUnknownFields(input, ["expectedVersion"], "revoke request");
      const credential = this.requireManageable(projectId, credentialId);
      const version = expectedVersion(input.expectedVersion);
      this.requireExpectedVersion(credential, version);
      const revoked = this.repository.revoke({ credentialId, expectedVersion: version });
      this.auditLifecycle("credential.revoke", projectId, revoked, "succeeded");
      return revoked;
    } catch (error) {
      this.auditLifecycleFailure("credential.revoke", projectId, credentialId, error);
      throw error;
    }
  }

  async promote(projectIdValue: string, credentialIdValue: string, inputValue: PromoteAutomationCredentialInput): Promise<AutomationCredentialMetadata> {
    const projectId = boundedString(projectIdValue, "projectId", MAX_IDENTIFIER_LENGTH);
    const credentialId = boundedString(credentialIdValue, "credentialId", MAX_IDENTIFIER_LENGTH);
    try {
      const input = requireObject(inputValue, "promotion request");
      rejectUnknownFields(input, ["allowedProjectIds", "expectedVersion", "confirmScopeExpansion"], "promotion request");
      if (input.confirmScopeExpansion !== true) {
        throw new ValidationError("confirmScopeExpansion must be true to promote a project credential to global scope.");
      }
      const credential = this.requireManageable(projectId, credentialId);
      this.requireExpectedVersion(credential, expectedVersion(input.expectedVersion));
      if (credential.scope !== "project" || credential.projectId !== projectId) {
        throw new CredentialAccessDeniedError("Only the managing project can promote its project credential.");
      }
      if (credential.status !== "active") throw new CredentialAccessDeniedError("Only active credentials can be promoted.");
      const requestedProjects = boundedList(input.allowedProjectIds, "allowedProjectIds", MAX_IDENTIFIER_LENGTH);
      if (!requestedProjects.includes(projectId)) throw new ValidationError("The global allowlist must retain the managing project.");
      const allowedProjectIds = [projectId, ...requestedProjects.filter((candidate) => candidate !== projectId)];
      for (const allowedProjectId of allowedProjectIds) this.repository.requireProject(allowedProjectId);
      await this.requireBackendReady();
      let plaintext: Buffer | null = null;
      try {
        plaintext = await this.secretStore.get(this.context(credential));
        const envelope = await this.secretStore.seal(this.contextFor(credential.id, null), plaintext);
        const promoted = this.repository.promoteWithEnvelope({
          credentialId,
          managementProjectId: projectId,
          expectedVersion: credential.version,
          expectedStatus: credential.status,
          allowedProjectIds,
          envelope,
        });
        this.auditLifecycle("credential.promote", projectId, promoted, "succeeded");
        return promoted;
      } catch (error) {
        if (error instanceof CredentialAccessDeniedError || (error instanceof Error && error.name === "CredentialConcurrentModificationError")) throw error;
        throw await this.classifyEncryptedStateError(error);
      } finally {
        plaintext?.fill(0);
      }
    } catch (error) {
      this.auditLifecycleFailure("credential.promote", projectId, credentialId, error);
      throw this.normalizeCustodyError(error);
    }
  }

  restrict(projectIdValue: string, credentialIdValue: string, inputValue: RestrictAutomationCredentialInput): AutomationCredentialMetadata {
    const projectId = boundedString(projectIdValue, "projectId", MAX_IDENTIFIER_LENGTH);
    const credentialId = boundedString(credentialIdValue, "credentialId", MAX_IDENTIFIER_LENGTH);
    try {
      const input = requireObject(inputValue, "restriction request");
      rejectUnknownFields(input, ["allowedProjectIds", "capabilities", "expectedVersion"], "restriction request");
      const credential = this.requireManageable(projectId, credentialId);
      this.requireExpectedVersion(credential, expectedVersion(input.expectedVersion));
      const requestedProjects = boundedList(input.allowedProjectIds, "allowedProjectIds", MAX_IDENTIFIER_LENGTH);
      const capabilities = boundedList(input.capabilities, "capabilities", MAX_CAPABILITY_LENGTH);
      if (credential.scope === "project" && requestedProjects.length > 0) {
        throw new ValidationError("Project credential restrictions must use an empty allowedProjectIds array.");
      }
      if (credential.scope === "global" && !requestedProjects.includes(projectId)) {
        throw new ValidationError("The global allowlist must retain the managing project.");
      }
      const allowedProjectIds = credential.scope === "global"
        ? [projectId, ...requestedProjects.filter((candidate) => candidate !== projectId)]
        : [];
      const expandedProject = allowedProjectIds.find((candidate) => !credential.allowedProjectIds.includes(candidate));
      if (expandedProject) throw new ValidationError("Restriction cannot add project access; use promotion only for the project-to-global scope expansion.");
      const expandedCapability = capabilities.find((candidate) => !credential.capabilities.includes(candidate));
      if (expandedCapability) throw new ValidationError("Restriction cannot add capabilities; submit only capabilities already granted by the credential.");
      for (const allowedProjectId of allowedProjectIds) this.repository.requireProject(allowedProjectId);
      const restricted = this.repository.restrict({
        credentialId,
        expectedVersion: credential.version,
        allowedProjectIds,
        capabilities,
      });
      this.auditLifecycle("credential.restrict", projectId, restricted, "succeeded");
      return restricted;
    } catch (error) {
      this.auditLifecycleFailure("credential.restrict", projectId, credentialId, error);
      throw error;
    }
  }

  async resolve(requestValue: CredentialResolutionRequest): Promise<ResolvedCredential> {
    const request = this.normalizeResolutionRequest(requestValue);
    for (let attempt = 0; attempt < MAX_RESOLUTION_RETRIES; attempt += 1) {
      const binding = this.repository.getBinding(request.projectId, request.bindingKey);
      if (!binding) return this.deny(request, null, "No credential binding exists.");
      const credential = this.repository.get(binding.credentialId);
      this.authorizeBoundResolution(request, binding, credential);
      const plaintext = await this.readSecretOrDeny(request, credential!);
      const currentBinding = this.repository.getBinding(request.projectId, request.bindingKey);
      const currentCredential = currentBinding ? this.repository.get(currentBinding.credentialId) : null;
      const stable = currentBinding?.credentialId === binding.credentialId
        && request.requiredCapabilities.every((capability) => currentBinding.requiredCapabilities.includes(capability))
        && currentCredential !== null
        && sameCredentialSnapshot(credential!, currentCredential);
      if (stable) return this.grant(request, currentCredential!, plaintext);
      plaintext.fill(0);
      this.authorizeBoundResolution(request, currentBinding, currentCredential);
    }
    return this.deny(request, null, "Credential changed repeatedly while access was being authorized.");
  }

  async resolveCredentialId(requestValue: CredentialResolutionRequest & { credentialId: string }): Promise<ResolvedCredential> {
    const credentialId = boundedString(requestValue.credentialId, "credentialId", MAX_IDENTIFIER_LENGTH);
    const request = { ...this.normalizeResolutionRequest(requestValue), credentialId };
    for (let attempt = 0; attempt < MAX_RESOLUTION_RETRIES; attempt += 1) {
      const credential = this.repository.get(credentialId);
      this.authorizeDirectResolution(request, credential);
      const plaintext = await this.readSecretOrDeny(request, credential!);
      const current = this.repository.get(credentialId);
      if (current && sameCredentialSnapshot(credential!, current)) return this.grant(request, current, plaintext);
      plaintext.fill(0);
      this.authorizeDirectResolution(request, current);
    }
    return this.deny(request, credentialId, "Credential changed repeatedly while access was being authorized.");
  }

  private async replaceValue(
    projectIdValue: string,
    credentialIdValue: string,
    inputValue: ReplaceAutomationCredentialSecretInput,
    rotation: boolean,
  ): Promise<AutomationCredentialMetadata> {
    const projectId = boundedString(projectIdValue, "projectId", MAX_IDENTIFIER_LENGTH);
    const credentialId = boundedString(credentialIdValue, "credentialId", MAX_IDENTIFIER_LENGTH);
    const action = rotation ? "credential.rotate" : "credential.replace";
    try {
      const input = requireObject(inputValue, rotation ? "rotation request" : "replacement request");
      rejectUnknownFields(input, ["value", "expectedVersion"], rotation ? "rotation request" : "replacement request");
      const credential = this.requireManageable(projectId, credentialId);
      this.requireExpectedVersion(credential, expectedVersion(input.expectedVersion));
      if (rotation && credential.status !== "active") throw new CredentialAccessDeniedError("Only active credentials can be rotated.");
      if (!rotation && credential.status === "revoked") throw new CredentialAccessDeniedError("Revoked credentials cannot be reactivated; create a new credential instead.");
      const value = secretValue(input.value, rotation ? "rotation value" : "replacement value");
      await this.requireBackendReady();
      const plaintext = Buffer.from(value, "utf8");
      try {
        const envelope = await this.secretStore.seal(this.context(credential), plaintext);
        const updated = this.repository.replaceEnvelope({
          credentialId,
          expectedVersion: credential.version,
          expectedStatus: credential.status,
          envelope,
          recordRotation: rotation,
        });
        this.auditLifecycle(action, projectId, updated, "succeeded");
        return updated;
      } finally {
        plaintext.fill(0);
      }
    } catch (error) {
      this.auditLifecycleFailure(action, projectId, credentialId, error);
      throw this.normalizeCustodyError(error);
    }
  }

  private normalizeResolutionRequest(requestValue: CredentialResolutionRequest): CredentialResolutionRequest {
    const input = requireObject(requestValue, "credential resolution request");
    const allowedKinds = boundedList(input.allowedKinds, "allowedKinds", MAX_KIND_LENGTH);
    if (allowedKinds.length === 0) throw new ValidationError("allowedKinds must declare at least one permitted credential kind.");
    return {
      projectId: boundedString(input.projectId, "projectId", MAX_IDENTIFIER_LENGTH),
      bindingKey: boundedString(input.bindingKey, "bindingKey", MAX_IDENTIFIER_LENGTH),
      workspaceId: boundedString(input.workspaceId, "workspaceId", MAX_IDENTIFIER_LENGTH),
      allowedKinds,
      requiredCapabilities: boundedList(input.requiredCapabilities, "requiredCapabilities", MAX_CAPABILITY_LENGTH),
    };
  }

  private context(credential: AutomationCredentialMetadata): SecretContext {
    return this.contextFor(credential.id, credential.projectId);
  }

  private contextFor(credentialId: string, projectId: string | null): SecretContext {
    const owner = projectId ?? "global";
    return { credentialId, projectId: owner, workspaceId: owner };
  }

  private canAccess(credential: AutomationCredentialMetadata, projectId: string): boolean {
    return credential.scope === "project"
      ? credential.projectId === projectId
      : credential.allowedProjectIds.includes(projectId);
  }

  private requireAccessible(projectId: string, credentialId: string): AutomationCredentialMetadata {
    this.repository.requireProject(projectId);
    const credential = this.repository.get(credentialId);
    if (!credential || !this.canAccess(credential, projectId)) {
      throw new CredentialAccessDeniedError("Credential is not available to this project.");
    }
    return credential;
  }

  private requireManageable(projectId: string, credentialId: string): AutomationCredentialMetadata {
    this.repository.requireProject(projectId);
    const credential = this.repository.get(credentialId);
    if (!credential || credential.managementProjectId !== projectId) {
      throw new CredentialAccessDeniedError("Credential is not managed by this project.");
    }
    return credential;
  }

  private requireExpectedVersion(credential: AutomationCredentialMetadata, version: number): void {
    if (credential.version !== version) {
      throw new CredentialConcurrentModificationError("Credential changed; refresh its metadata and retry with the current version.");
    }
  }

  private authorizeBoundResolution(
    request: CredentialResolutionRequest,
    binding: AutomationCredentialBinding | null,
    credential: AutomationCredentialMetadata | null,
  ): void {
    if (!binding) return this.deny(request, null, "No credential binding exists.");
    if (!credential) return this.deny(request, binding.credentialId, "Bound credential is missing.");
    this.authorizeCredentialPolicy(request, credential);
    if (!request.requiredCapabilities.every((capability) => binding.requiredCapabilities.includes(capability))) {
      return this.deny(request, credential.id, "The binding does not approve every required capability.");
    }
  }

  private authorizeDirectResolution(
    request: CredentialResolutionRequest & { credentialId: string },
    credential: AutomationCredentialMetadata | null,
  ): void {
    if (!credential) return this.deny(request, request.credentialId, "Credential is missing.");
    this.authorizeCredentialPolicy(request, credential);
  }

  private authorizeCredentialPolicy(request: CredentialResolutionRequest, credential: AutomationCredentialMetadata): void {
    if (!this.canAccess(credential, request.projectId)) return this.deny(request, credential.id, "Credential is outside the project scope.");
    if (credential.status !== "active") return this.deny(request, credential.id, "Credential is not active.");
    if (!request.allowedKinds.includes(credential.kind)) return this.deny(request, credential.id, "Credential kind is not approved for this consumer.");
    if (!request.requiredCapabilities.every((capability) => credential.capabilities.includes(capability))) {
      return this.deny(request, credential.id, "Credential does not approve every required capability.");
    }
  }

  private async readSecretOrDeny(request: CredentialResolutionRequest, credential: AutomationCredentialMetadata): Promise<Buffer> {
    try {
      return await this.secretStore.get(this.context(credential));
    } catch {
      return this.deny(request, credential.id, "Credential encrypted state or key custody is unavailable.");
    }
  }

  private grant(request: CredentialResolutionRequest, credential: AutomationCredentialMetadata, plaintext: Buffer): ResolvedCredential {
    try {
      this.repository.recordAccess({
        credentialId: credential.id,
        projectId: request.projectId,
        bindingKey: request.bindingKey,
        capability: request.requiredCapabilities.join(",") || null,
        operation: "resolve",
        outcome: "granted",
        reason: null,
      });
      this.auditService?.recordSystem({
        action: "credential.access",
        resourceType: "automation_credential",
        resourceId: credential.id,
        projectId: request.projectId,
        outcome: "succeeded",
        metadata: {
          bindingKey: request.bindingKey,
          requiredCapabilities: request.requiredCapabilities,
          allowedKinds: request.allowedKinds,
          credentialVersion: credential.version,
        },
      });
      return { credentialId: credential.id, value: plaintext.toString("utf8"), version: credential.version };
    } finally {
      plaintext.fill(0);
    }
  }

  private deny(request: CredentialResolutionRequest, credentialId: string | null, reason: string): never {
    this.repository.recordAccess({
      credentialId,
      projectId: request.projectId,
      bindingKey: request.bindingKey,
      capability: request.requiredCapabilities.join(",") || null,
      operation: "resolve",
      outcome: "denied",
      reason,
    });
    this.auditService?.recordSystem({
      action: "credential.access",
      resourceType: "automation_credential",
      resourceId: credentialId,
      projectId: request.projectId,
      outcome: "denied",
      metadata: {
        bindingKey: request.bindingKey,
        requiredCapabilities: request.requiredCapabilities,
        allowedKinds: request.allowedKinds,
        reason,
      },
    });
    throw new CredentialAccessDeniedError(reason);
  }

  private async requireBackendReady(): Promise<void> {
    const health = await this.safeHealth();
    if (!isBackendReady(health)) {
      throw new CredentialKeyCustodyUnavailableError();
    }
  }

  private async safeHealth(): Promise<CredentialBackendHealth> {
    try {
      return await this.keyProvider.health();
    } catch {
      return {
        available: false,
        secure: false,
        provider: this.keyProvider.providerName,
        keyId: null,
        keyVersion: null,
        reason: "Credential key provider health check failed.",
      };
    }
  }

  private async classifyEncryptedStateError(error: unknown): Promise<CredentialKeyCustodyUnavailableError | CredentialEncryptedStateError> {
    if (error instanceof CredentialKeyCustodyUnavailableError || error instanceof KeyProviderUnavailableError) {
      return new CredentialKeyCustodyUnavailableError();
    }
    const health = await this.safeHealth();
    return health.available && health.secure
      ? new CredentialEncryptedStateError()
      : new CredentialKeyCustodyUnavailableError();
  }

  private normalizeCustodyError(error: unknown): unknown {
    return error instanceof KeyProviderUnavailableError ? new CredentialKeyCustodyUnavailableError() : error;
  }

  private auditLifecycle(
    action: string,
    projectId: string,
    credential: AutomationCredentialMetadata,
    outcome: "succeeded" | "denied" | "failed",
  ): void {
    try {
      this.auditService?.recordSystem({
        action,
        resourceType: "automation_credential",
        resourceId: credential.id,
        projectId,
        outcome,
        metadata: {
          credentialVersion: credential.version,
          kind: credential.kind,
          scope: credential.scope,
          managementProjectId: credential.managementProjectId,
          allowedProjectIds: credential.allowedProjectIds,
          capabilities: credential.capabilities,
          status: credential.status,
          configured: credential.configured,
          validationStatus: credential.validationStatus,
        },
      });
    } catch {
      // Credential availability must not depend on the audit exporter being writable.
    }
  }

  private auditLifecycleFailure(action: string, projectId: string, credentialId: string | null, error: unknown): void {
    try {
      const credential = credentialId ? this.repository.get(credentialId) : null;
      this.auditService?.recordSystem({
        action,
        resourceType: "automation_credential",
        resourceId: credentialId,
        projectId,
        outcome: error instanceof CredentialAccessDeniedError ? "denied" : "failed",
        metadata: {
          errorType: error instanceof Error ? error.name : "UnknownError",
          credentialVersion: credential?.version ?? null,
          kind: credential?.kind ?? null,
          scope: credential?.scope ?? null,
          managementProjectId: credential?.managementProjectId ?? null,
          allowedProjectIds: credential?.allowedProjectIds ?? [],
          capabilities: credential?.capabilities ?? [],
          status: credential?.status ?? null,
        },
      });
    } catch {
      // Preserve the original lifecycle error when audit persistence is unavailable.
    }
  }
}
