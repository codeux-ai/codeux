import { randomUUID } from "node:crypto";
import type {
  AutomationCredentialBinding,
  AutomationCredentialMetadata,
  AutomationCredentialStatus,
  CreateAutomationCredentialInput,
  CredentialBackendHealth,
  CredentialResolutionRequest,
  ResolvedCredential,
} from "../../contracts/automation-credential-types.js";
import type { AutomationCredentialRepository } from "../../repositories/automation-credential-repository.js";
import { ValidationError } from "../../repositories/repository-utils.js";
import type { AutomationAuditExportService } from "../automation-audit-export-service.js";
import type { KeyProvider } from "./key-provider.js";
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

function boundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new ValidationError(`${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new ValidationError(`${label} is required.`);
  if (normalized.length > maxLength) throw new ValidationError(`${label} must be at most ${maxLength} characters.`);
  if (CONTROL_CHARACTERS.test(normalized)) throw new ValidationError(`${label} cannot contain control characters.`);
  return normalized;
}

function boundedList(value: unknown, label: string, itemMaxLength: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ValidationError(`${label} must be an array of strings.`);
  if (value.length > MAX_LIST_ITEMS) throw new ValidationError(`${label} cannot contain more than ${MAX_LIST_ITEMS} entries.`);
  const normalized = value.map((item) => boundedString(item, `${label} entry`, itemMaxLength));
  return [...new Set(normalized)];
}

function secretValue(value: unknown, label = "value"): string {
  if (typeof value !== "string" || value.length === 0) throw new ValidationError(`A non-empty ${label} is required.`);
  if (Buffer.byteLength(value, "utf8") > MAX_SECRET_BYTES) throw new ValidationError(`${label} must be at most ${MAX_SECRET_BYTES} UTF-8 bytes.`);
  return value;
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

  async create(projectIdValue: string, input: CreateAutomationCredentialInput): Promise<AutomationCredentialMetadata> {
    const projectId = boundedString(projectIdValue, "projectId", MAX_IDENTIFIER_LENGTH);
    this.repository.requireProject(projectId);
    const name = boundedString(input?.name, "name", MAX_NAME_LENGTH);
    const kind = boundedString(input?.kind, "kind", MAX_KIND_LENGTH);
    if (!CREDENTIAL_KIND.test(kind)) throw new ValidationError("kind may contain only letters, numbers, dots, underscores, colons, and hyphens.");
    const value = secretValue(input?.value);
    const scope = input?.scope ?? "project";
    if (scope !== "project" && scope !== "global") throw new ValidationError("scope must be either project or global.");
    const requestedProjects = boundedList(input?.allowedProjectIds, "allowedProjectIds", MAX_IDENTIFIER_LENGTH);
    if (scope === "global" && !requestedProjects.includes(projectId)) {
      throw new ValidationError("Global credentials require an explicit allowlist containing the configuring project.");
    }
    const allowedProjectIds = scope === "global"
      ? [projectId, ...requestedProjects.filter((candidate) => candidate !== projectId)]
      : [];
    const capabilities = boundedList(input?.capabilities, "capabilities", MAX_CAPABILITY_LENGTH);
    const id = randomUUID();
    const context = this.contextFor(id, scope === "project" ? projectId : null);
    const plaintext = Buffer.from(value, "utf8");
    try {
      const envelope = await this.secretStore.seal(context, plaintext);
      return this.repository.createWithEnvelope({
        id,
        name,
        kind,
        scope,
        projectId: scope === "project" ? projectId : null,
        managementProjectId: projectId,
        allowedProjectIds,
        capabilities,
      }, envelope);
    } finally {
      plaintext.fill(0);
    }
  }

  bind(projectIdValue: string, credentialIdValue: string, bindingKeyValue: string, capabilitiesValue: unknown): AutomationCredentialBinding {
    const projectId = boundedString(projectIdValue, "projectId", MAX_IDENTIFIER_LENGTH);
    const credentialId = boundedString(credentialIdValue, "credentialId", MAX_IDENTIFIER_LENGTH);
    const bindingKey = boundedString(bindingKeyValue, "bindingKey", MAX_IDENTIFIER_LENGTH);
    const credential = this.requireAccessible(projectId, credentialId);
    if (credential.status !== "active") throw new CredentialAccessDeniedError("Only active credentials can be bound.");
    const required = boundedList(capabilitiesValue, "capabilities", MAX_CAPABILITY_LENGTH);
    if (required.some((capability) => !credential.capabilities.includes(capability))) {
      throw new CredentialAccessDeniedError("Binding requests capabilities the credential does not grant.");
    }
    return this.repository.bind(credentialId, projectId, bindingKey, required);
  }

  async test(projectIdValue: string, credentialIdValue: string): Promise<AutomationCredentialMetadata> {
    const projectId = boundedString(projectIdValue, "projectId", MAX_IDENTIFIER_LENGTH);
    const credentialId = boundedString(credentialIdValue, "credentialId", MAX_IDENTIFIER_LENGTH);
    const credential = this.requireAccessible(projectId, credentialId);
    let plaintext: Buffer | null = null;
    try {
      plaintext = await this.secretStore.get(this.context(credential));
      const current = this.repository.get(credentialId);
      if (!current || !sameCredentialSnapshot(credential, current) || !this.canAccess(current, projectId) || current.status !== "active") {
        throw new CredentialAccessDeniedError("Credential changed while it was being tested; retry the operation.");
      }
      return this.repository.updateValidation(credentialId, "valid");
    } catch (error) {
      if (error instanceof CredentialAccessDeniedError) throw error;
      this.repository.updateValidation(credentialId, "invalid");
      throw new Error("Credential validation failed.");
    } finally {
      plaintext?.fill(0);
    }
  }

  async rotate(projectId: string, credentialId: string, value: string): Promise<AutomationCredentialMetadata> {
    return this.replaceValue(projectId, credentialId, value, true);
  }

  async replace(projectId: string, credentialId: string, value: string): Promise<AutomationCredentialMetadata> {
    return this.replaceValue(projectId, credentialId, value, false);
  }

  revoke(projectIdValue: string, credentialIdValue: string): AutomationCredentialMetadata {
    const projectId = boundedString(projectIdValue, "projectId", MAX_IDENTIFIER_LENGTH);
    const credentialId = boundedString(credentialIdValue, "credentialId", MAX_IDENTIFIER_LENGTH);
    this.requireManageable(projectId, credentialId);
    return this.repository.updateStatus(credentialId, "revoked");
  }

  async promote(projectIdValue: string, credentialIdValue: string, allowedProjectIdsValue: unknown): Promise<AutomationCredentialMetadata> {
    const projectId = boundedString(projectIdValue, "projectId", MAX_IDENTIFIER_LENGTH);
    const credentialId = boundedString(credentialIdValue, "credentialId", MAX_IDENTIFIER_LENGTH);
    const credential = this.requireManageable(projectId, credentialId);
    if (credential.scope !== "project" || credential.projectId !== projectId) {
      throw new CredentialAccessDeniedError("Only the managing project can promote a project credential.");
    }
    if (credential.status !== "active") throw new CredentialAccessDeniedError("Only active credentials can be promoted.");
    const requestedProjects = boundedList(allowedProjectIdsValue, "allowedProjectIds", MAX_IDENTIFIER_LENGTH);
    if (!requestedProjects.includes(projectId)) throw new ValidationError("The global allowlist must retain the managing project.");
    const allowedProjectIds = [projectId, ...requestedProjects.filter((candidate) => candidate !== projectId)];
    for (const allowedProjectId of allowedProjectIds) this.repository.requireProject(allowedProjectId);
    const plaintext = await this.secretStore.get(this.context(credential));
    try {
      const envelope = await this.secretStore.seal(this.contextFor(credential.id, null), plaintext);
      return this.repository.promoteWithEnvelope({
        credentialId,
        managementProjectId: projectId,
        expectedVersion: credential.version,
        expectedStatus: credential.status,
        allowedProjectIds,
        envelope,
      });
    } finally {
      plaintext.fill(0);
    }
  }

  restrict(projectIdValue: string, credentialIdValue: string, allowedProjectIdsValue: unknown, capabilitiesValue: unknown): AutomationCredentialMetadata {
    const projectId = boundedString(projectIdValue, "projectId", MAX_IDENTIFIER_LENGTH);
    const credentialId = boundedString(credentialIdValue, "credentialId", MAX_IDENTIFIER_LENGTH);
    const credential = this.requireManageable(projectId, credentialId);
    const requestedProjects = boundedList(allowedProjectIdsValue, "allowedProjectIds", MAX_IDENTIFIER_LENGTH);
    if (credential.scope === "global" && !requestedProjects.includes(projectId)) {
      throw new ValidationError("The global allowlist must retain the managing project.");
    }
    const allowedProjectIds = credential.scope === "global"
      ? [projectId, ...requestedProjects.filter((candidate) => candidate !== projectId)]
      : [];
    const capabilities = boundedList(capabilitiesValue, "capabilities", MAX_CAPABILITY_LENGTH);
    return this.repository.restrict(credentialId, allowedProjectIds, capabilities);
  }

  async resolve(request: CredentialResolutionRequest): Promise<ResolvedCredential> {
    for (let attempt = 0; attempt < MAX_RESOLUTION_RETRIES; attempt += 1) {
      const binding = this.repository.getBinding(request.projectId, request.bindingKey);
      if (!binding) return this.deny(request, null, "No credential binding exists.");
      const credential = this.repository.get(binding.credentialId);
      this.authorizeBoundResolution(request, binding, credential);
      const plaintext = await this.readSecretOrDeny(request, credential!);
      const currentBinding = this.repository.getBinding(request.projectId, request.bindingKey);
      const currentCredential = currentBinding ? this.repository.get(currentBinding.credentialId) : null;
      const stable = currentBinding?.credentialId === binding.credentialId
        && currentBinding.requiredCapabilities.includes(request.capability)
        && currentCredential !== null
        && sameCredentialSnapshot(credential!, currentCredential);
      if (stable) return this.grant(request, currentCredential!, plaintext);
      plaintext.fill(0);
      this.authorizeBoundResolution(request, currentBinding, currentCredential);
    }
    return this.deny(request, null, "Credential changed repeatedly while access was being authorized.");
  }

  async resolveCredentialId(request: CredentialResolutionRequest & { credentialId: string }): Promise<ResolvedCredential> {
    for (let attempt = 0; attempt < MAX_RESOLUTION_RETRIES; attempt += 1) {
      const credential = this.repository.get(request.credentialId);
      this.authorizeDirectResolution(request, credential);
      const plaintext = await this.readSecretOrDeny(request, credential!);
      const current = this.repository.get(request.credentialId);
      if (current && sameCredentialSnapshot(credential!, current)) return this.grant(request, current, plaintext);
      plaintext.fill(0);
      this.authorizeDirectResolution(request, current);
    }
    return this.deny(request, request.credentialId, "Credential changed repeatedly while access was being authorized.");
  }

  async withResolvedCredentialId<T>(
    request: CredentialResolutionRequest & { credentialId: string },
    consumer: (plaintext: Buffer) => T | Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < MAX_RESOLUTION_RETRIES; attempt += 1) {
      const credential = this.repository.get(request.credentialId);
      this.authorizeDirectResolution(request, credential);
      const plaintext = await this.readSecretOrDeny(request, credential!);
      const current = this.repository.get(request.credentialId);
      if (current && sameCredentialSnapshot(credential!, current)) {
        this.recordGrantedAccess(request, current);
        try {
          return await consumer(plaintext);
        } finally {
          plaintext.fill(0);
        }
      }
      plaintext.fill(0);
      this.authorizeDirectResolution(request, current);
    }
    return this.deny(request, request.credentialId, "Credential changed repeatedly while access was being authorized.");
  }

  private async replaceValue(projectIdValue: string, credentialIdValue: string, valueValue: string, rotation: boolean): Promise<AutomationCredentialMetadata> {
    const projectId = boundedString(projectIdValue, "projectId", MAX_IDENTIFIER_LENGTH);
    const credentialId = boundedString(credentialIdValue, "credentialId", MAX_IDENTIFIER_LENGTH);
    const credential = this.requireManageable(projectId, credentialId);
    if (rotation && credential.status !== "active") throw new CredentialAccessDeniedError("Only active credentials can be rotated.");
    const value = secretValue(valueValue, "replacement value");
    const plaintext = Buffer.from(value, "utf8");
    try {
      const envelope = await this.secretStore.seal(this.context(credential), plaintext);
      return this.repository.replaceEnvelope({
        credentialId,
        expectedVersion: credential.version,
        expectedStatus: credential.status,
        envelope,
        recordRotation: rotation,
      });
    } finally {
      plaintext.fill(0);
    }
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

  private authorizeBoundResolution(request: CredentialResolutionRequest, binding: AutomationCredentialBinding | null, credential: AutomationCredentialMetadata | null): void {
    if (!binding) return this.deny(request, null, "No credential binding exists.");
    if (!credential) return this.deny(request, binding.credentialId, "Bound credential is missing.");
    if (!this.canAccess(credential, request.projectId)) return this.deny(request, credential.id, "Credential is outside the project scope.");
    if (credential.status !== "active") return this.deny(request, credential.id, "Credential is not active.");
    if (!credential.capabilities.includes(request.capability) || !binding.requiredCapabilities.includes(request.capability)) {
      return this.deny(request, credential.id, "Required capability is not approved.");
    }
  }

  private authorizeDirectResolution(request: CredentialResolutionRequest & { credentialId: string }, credential: AutomationCredentialMetadata | null): void {
    if (!credential) return this.deny(request, request.credentialId, "Credential is missing.");
    if (!this.canAccess(credential, request.projectId)) return this.deny(request, credential.id, "Credential is outside the project scope.");
    if (credential.status !== "active") return this.deny(request, credential.id, "Credential is not active.");
    if (!credential.capabilities.includes(request.capability)) return this.deny(request, credential.id, "Required capability is not approved.");
  }

  private async readSecretOrDeny(request: CredentialResolutionRequest, credential: AutomationCredentialMetadata): Promise<Buffer> {
    try {
      return await this.secretStore.get(this.context(credential));
    } catch {
      return this.deny(request, credential.id, "Credential backend is unavailable or authentication failed.");
    }
  }

  private grant(request: CredentialResolutionRequest, credential: AutomationCredentialMetadata, plaintext: Buffer): ResolvedCredential {
    try {
      this.recordGrantedAccess(request, credential);
      return { credentialId: credential.id, value: plaintext.toString("utf8"), version: credential.version };
    } finally {
      plaintext.fill(0);
    }
  }

  private recordGrantedAccess(request: CredentialResolutionRequest, credential: AutomationCredentialMetadata): void {
    this.repository.recordAccess({
      credentialId: credential.id,
      projectId: request.projectId,
      bindingKey: request.bindingKey,
      capability: request.capability,
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
      metadata: { bindingKey: request.bindingKey, capability: request.capability, credentialVersion: credential.version },
    });
  }

  private deny(request: CredentialResolutionRequest, credentialId: string | null, reason: string): never {
    this.repository.recordAccess({
      credentialId,
      projectId: request.projectId,
      bindingKey: request.bindingKey,
      capability: request.capability,
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
      metadata: { bindingKey: request.bindingKey, capability: request.capability, reason },
    });
    throw new CredentialAccessDeniedError(reason);
  }
}
