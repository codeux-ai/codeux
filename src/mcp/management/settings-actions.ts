import { createHash } from "node:crypto";
import type { ManageCodeUxArgs, ManagementResponseEnvelope } from "../../contracts/internal-management-types.js";
import type { SettingsRepository } from "../../repositories/settings-repository.js";
import { SettingsPathUpdater } from "../../services/settings-path-updater.js";
import type { SystemSettings, ProjectSettingsOverride, SprintSettingsOverride } from "../../contracts/settings-scope-types.js";
import {
  buildMcpApprovalFingerprint,
  managementValidationError,
  parseRequiredObject,
  parseRequiredPresentValue,
  parseRequiredString as readRequiredString,
} from "./payload-parsers.js";

const SETTINGS_APPROVAL_TTL_MS = 15 * 60 * 1000;
const SETTINGS_BUNDLE_SCHEMA_VERSION = 1;
const SECRET_REDACTION = "[REDACTED]";
const SETTINGS_APPROVAL_MESSAGE = [
  "Settings change queued and waiting for human confirmation.",
  "Ask the user to confirm this exact settings change before calling the tool again.",
  "DO NOT call this settings endpoint again with approval.confirmed: true unless the user explicitly confirms.",
  "This approval is one-use, bound to this exact action and payload, and expires in 15 minutes.",
].join(" ");

type SettingsBundleScope = "system" | "projects" | "sprints";

interface SettingsBundleProjectEntry {
  projectId: string;
  settings: ProjectSettingsOverride;
}

interface SettingsBundleSprintEntry {
  projectId: string;
  sprintId: string;
  settings: SprintSettingsOverride;
}

interface SettingsBundleMetadata {
  schemaVersion: number;
  exportedAt: string;
  includedScopes: SettingsBundleScope[];
  fingerprint: string;
  containsSecrets: boolean;
}

interface SettingsBundle {
  metadata: SettingsBundleMetadata;
  system?: SystemSettings;
  projects?: SettingsBundleProjectEntry[];
  sprints?: SettingsBundleSprintEntry[];
}

const SETTINGS_BUNDLE_SCOPES: SettingsBundleScope[] = ["system", "projects", "sprints"];
const SECRET_KEY_PATTERNS = [
  /apiKey/i,
  /apiToken/i,
  /githubToken/i,
  /gitlabToken/i,
  /jiraToken/i,
  /bearerToken/i,
  /authToken/i,
  /accessToken/i,
  /refreshToken/i,
  /password/i,
  /secret/i,
];
const LOGIN_CREDENTIAL_KEYS = new Set(["authPath", "lastLoginAt"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeScopes(value: unknown, fallback: SettingsBundleScope[]): SettingsBundleScope[] {
  if (value === undefined) {
    return fallback;
  }
  if (!Array.isArray(value)) {
    throw managementValidationError("scopes must be an array of settings bundle scopes", "scopes");
  }
  const scopes = value.map((item) => {
    if (typeof item !== "string" || !SETTINGS_BUNDLE_SCOPES.includes(item as SettingsBundleScope)) {
      throw managementValidationError("scopes must contain only system, projects, or sprints", "scopes");
    }
    return item as SettingsBundleScope;
  });
  return [...new Set(scopes)];
}

function readOptionalStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw managementValidationError(`${key} must be an array of non-empty strings`, key);
  }
  return value.map((item) => item.trim());
}

function isSecretPath(path: readonly string[]): boolean {
  const leaf = path[path.length - 1] || "";
  if (SECRET_KEY_PATTERNS.some((pattern) => pattern.test(leaf))) {
    return true;
  }
  if (LOGIN_CREDENTIAL_KEYS.has(leaf)) {
    return true;
  }
  if (leaf === "authType") {
    return true;
  }
  return false;
}

function hasSecretValue(value: unknown, path: string[] = []): boolean {
  if (isSecretPath(path)) {
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    return value !== undefined && value !== null && value !== false;
  }
  if (Array.isArray(value)) {
    return value.some((item, index) => hasSecretValue(item, [...path, String(index)]));
  }
  if (isPlainObject(value)) {
    return Object.entries(value).some(([key, child]) => hasSecretValue(child, [...path, key]));
  }
  return false;
}

function redactSecretValues(value: unknown, path: string[] = []): unknown {
  if (isSecretPath(path)) {
    if (typeof value === "string" && value.trim().length > 0) {
      return SECRET_REDACTION;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return value ? SECRET_REDACTION : value;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => redactSecretValues(item, [...path, String(index)]));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, redactSecretValues(child, [...path, key])]),
    );
  }
  return value;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildBundleFingerprint(bundleWithoutFingerprint: Omit<SettingsBundle, "metadata"> & {
  metadata: Omit<SettingsBundleMetadata, "fingerprint">;
}): string {
  const nonSecret = redactSecretValues(bundleWithoutFingerprint);
  return createHash("sha256").update(stableStringify(nonSecret)).digest("hex");
}

function buildBundleMetadata(bundle: Omit<SettingsBundle, "metadata">, includedScopes: SettingsBundleScope[]): SettingsBundleMetadata {
  const metadataWithoutFingerprint = {
    schemaVersion: SETTINGS_BUNDLE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    includedScopes,
    containsSecrets: hasSecretValue(bundle),
  };
  return {
    ...metadataWithoutFingerprint,
    fingerprint: buildBundleFingerprint({ ...bundle, metadata: metadataWithoutFingerprint }),
  };
}

function parseBundle(payload: Record<string, unknown>): SettingsBundle {
  const rawBundle = payload.bundle ?? payload.settingsBundle;
  if (!isPlainObject(rawBundle)) {
    throw managementValidationError("bundle object is required", "bundle");
  }
  const rawMetadata = rawBundle.metadata;
  if (!isPlainObject(rawMetadata) || rawMetadata.schemaVersion !== SETTINGS_BUNDLE_SCHEMA_VERSION) {
    throw managementValidationError(`bundle.metadata.schemaVersion must be ${SETTINGS_BUNDLE_SCHEMA_VERSION}`, "bundle");
  }

  const includedScopes = normalizeScopes(rawMetadata.includedScopes, SETTINGS_BUNDLE_SCOPES);
  const bundle: SettingsBundle = {
    metadata: {
      schemaVersion: SETTINGS_BUNDLE_SCHEMA_VERSION,
      exportedAt: typeof rawMetadata.exportedAt === "string" ? rawMetadata.exportedAt : "",
      includedScopes,
      fingerprint: typeof rawMetadata.fingerprint === "string" ? rawMetadata.fingerprint : "",
      containsSecrets: rawMetadata.containsSecrets === true,
    },
  };

  if ("system" in rawBundle) {
    if (!isPlainObject(rawBundle.system)) {
      throw managementValidationError("bundle.system must be an object", "bundle");
    }
    bundle.system = rawBundle.system as unknown as SystemSettings;
  }
  if ("projects" in rawBundle) {
    if (!Array.isArray(rawBundle.projects)) {
      throw managementValidationError("bundle.projects must be an array", "bundle");
    }
    bundle.projects = rawBundle.projects.map((entry, index) => {
      if (!isPlainObject(entry) || typeof entry.projectId !== "string" || entry.projectId.trim().length === 0 || !isPlainObject(entry.settings)) {
        throw managementValidationError(`bundle.projects[${index}] must include projectId and settings`, "bundle");
      }
      return { projectId: entry.projectId.trim(), settings: entry.settings as ProjectSettingsOverride };
    });
  }
  if ("sprints" in rawBundle) {
    if (!Array.isArray(rawBundle.sprints)) {
      throw managementValidationError("bundle.sprints must be an array", "bundle");
    }
    bundle.sprints = rawBundle.sprints.map((entry, index) => {
      if (!isPlainObject(entry)
        || typeof entry.projectId !== "string"
        || entry.projectId.trim().length === 0
        || typeof entry.sprintId !== "string"
        || entry.sprintId.trim().length === 0
        || !isPlainObject(entry.settings)) {
        throw managementValidationError(`bundle.sprints[${index}] must include projectId, sprintId, and settings`, "bundle");
      }
      return { projectId: entry.projectId.trim(), sprintId: entry.sprintId.trim(), settings: entry.settings as SprintSettingsOverride };
    });
  }
  return bundle;
}

export class SettingsActions {
  private readonly pendingSettingsApprovals = new Map<string, number>();

  constructor(private readonly settingsRepository: SettingsRepository) {}

  async handleSettingsAction(args: ManageCodeUxArgs): Promise<ManagementResponseEnvelope> {
    const payload = args.payload || {};

    switch (args.action) {
      case "get_system":
        return this.getSystemSettings();
      case "get_project_override":
        return this.getProjectOverride(payload);
      case "resolve_project_effective":
        return this.resolveProjectEffective(payload);
      case "get_sprint_override":
        return this.getSprintOverride(payload);
      case "resolve_sprint_effective":
        return this.resolveSprintEffective(payload);
      case "replace_system_settings":
        return this.replaceSystemSettings(args, payload);
      case "patch_system_setting":
        return this.patchSystemSetting(args, payload);
      case "replace_project_settings":
        return this.replaceProjectSettings(args, payload);
      case "patch_project_setting":
        return this.patchProjectSetting(args, payload);
      case "reset_project_settings":
        return this.resetProjectSettings(args, payload);
      case "replace_sprint_settings":
        return this.replaceSprintSettings(args, payload);
      case "patch_sprint_setting":
        return this.patchSprintSetting(args, payload);
      case "reset_sprint_settings":
        return this.resetSprintSettings(args, payload);
      case "export_settings_bundle":
        return this.exportSettingsBundle(args, payload);
      case "apply_settings_bundle":
        return this.applySettingsBundle(args, payload);
      default:
        throw new Error(`Unknown settings action: ${args.action}`);
    }
  }

  private getSystemSettings(): ManagementResponseEnvelope {
    return { result: { settings: this.settingsRepository.getSystemSettings() } };
  }

  private requireSettingsApproval(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope | null {
    const now = Date.now();
    for (const [fingerprint, createdAt] of this.pendingSettingsApprovals.entries()) {
      if (now - createdAt > SETTINGS_APPROVAL_TTL_MS) {
        this.pendingSettingsApprovals.delete(fingerprint);
      }
    }

    const fingerprint = buildMcpApprovalFingerprint({ domain: "settings", action: args.action, payload });
    const pendingCreatedAt = this.pendingSettingsApprovals.get(fingerprint);
    if (args.approval?.confirmed === true && pendingCreatedAt !== undefined && now - pendingCreatedAt <= SETTINGS_APPROVAL_TTL_MS) {
      this.pendingSettingsApprovals.delete(fingerprint);
      return null;
    }

    this.pendingSettingsApprovals.set(fingerprint, now);
    return {
      approvalRequired: true,
      approvalMessage: SETTINGS_APPROVAL_MESSAGE,
    };
  }

  private getProjectOverride(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = readRequiredString(payload, "projectId");
    return { result: { override: this.settingsRepository.getProjectSettings(projectId) } };
  }

  private resolveProjectEffective(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = readRequiredString(payload, "projectId");
    return { result: { settings: this.settingsRepository.resolveProjectDashboardSettings(projectId) } };
  }

  private getSprintOverride(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const sprintId = readRequiredString(payload, "sprintId");
    return { result: { override: this.settingsRepository.getSprintSettings(sprintId) } };
  }

  private resolveSprintEffective(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = readRequiredString(payload, "projectId");
    const sprintId = readRequiredString(payload, "sprintId");
    return { result: { settings: this.settingsRepository.resolveSprintDashboardSettings(projectId, sprintId) } };
  }

  private replaceSystemSettings(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const settings = parseRequiredObject<SystemSettings>(payload, "settings", "settings object is required");
    const approval = this.requireSettingsApproval(args, payload);
    if (approval) return approval;
    return { result: { settings: this.settingsRepository.saveSystemSettings(settings) } };
  }

  private patchSystemSetting(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const path = readRequiredString(payload, "path");
    const value = parseRequiredPresentValue(payload, "value");
    const approval = this.requireSettingsApproval(args, payload);
    if (approval) return approval;

    const current = this.settingsRepository.getSystemSettings();
    const updated = SettingsPathUpdater.patchObject(current, path, value);
    return { result: { settings: this.settingsRepository.saveSystemSettings(updated) } };
  }

  private replaceProjectSettings(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = readRequiredString(payload, "projectId");
    const settings = parseRequiredObject<ProjectSettingsOverride>(payload, "settings", "settings object is required");
    const approval = this.requireSettingsApproval(args, payload);
    if (approval) return approval;
    return { result: { settings: this.settingsRepository.saveProjectSettings(projectId, settings) } };
  }

  private patchProjectSetting(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = readRequiredString(payload, "projectId");
    const path = readRequiredString(payload, "path");
    const value = parseRequiredPresentValue(payload, "value");
    const approval = this.requireSettingsApproval(args, payload);
    if (approval) return approval;

    const current = this.settingsRepository.getProjectSettings(projectId);
    const updated = SettingsPathUpdater.patchObject(current, path, value);
    return { result: { settings: this.settingsRepository.saveProjectSettings(projectId, updated) } };
  }

  private resetProjectSettings(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = readRequiredString(payload, "projectId");
    const approval = this.requireSettingsApproval(args, payload);
    if (approval) return approval;
    this.settingsRepository.resetProjectSettings(projectId);
    return { result: { success: true } };
  }

  private replaceSprintSettings(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = readRequiredString(payload, "projectId");
    const sprintId = readRequiredString(payload, "sprintId");
    const settings = parseRequiredObject<SprintSettingsOverride>(payload, "settings", "settings object is required");
    const approval = this.requireSettingsApproval(args, payload);
    if (approval) return approval;

    const baseProjectSettings = this.settingsRepository.getProjectResolvedSettings(projectId);
    return { result: { settings: this.settingsRepository.saveSprintSettings(sprintId, baseProjectSettings, settings) } };
  }

  private patchSprintSetting(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = readRequiredString(payload, "projectId");
    const sprintId = readRequiredString(payload, "sprintId");
    const path = readRequiredString(payload, "path");
    const value = parseRequiredPresentValue(payload, "value");
    const approval = this.requireSettingsApproval(args, payload);
    if (approval) return approval;

    const current = this.settingsRepository.getSprintSettings(sprintId);
    const updated = SettingsPathUpdater.patchObject(current, path, value);
    const baseProjectSettings = this.settingsRepository.getProjectResolvedSettings(projectId);

    return { result: { settings: this.settingsRepository.saveSprintSettings(sprintId, baseProjectSettings, updated) } };
  }

  private resetSprintSettings(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const sprintId = readRequiredString(payload, "sprintId");
    const approval = this.requireSettingsApproval(args, payload);
    if (approval) return approval;
    this.settingsRepository.resetSprintSettings(sprintId);
    return { result: { success: true } };
  }

  private exportSettingsBundle(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const includedScopes = normalizeScopes(payload.scopes, ["system"]);
    const includeSecrets = payload.includeSecrets === true;
    const projectIds = readOptionalStringArray(payload, "projectIds");
    const sprintIds = readOptionalStringArray(payload, "sprintIds");
    const projectId = typeof payload.projectId === "string" && payload.projectId.trim().length > 0 ? payload.projectId.trim() : undefined;
    const sprintId = typeof payload.sprintId === "string" && payload.sprintId.trim().length > 0 ? payload.sprintId.trim() : undefined;
    const bundle: Omit<SettingsBundle, "metadata"> = {};

    if (includedScopes.includes("system")) {
      bundle.system = this.settingsRepository.getSystemSettings();
    }
    if (includedScopes.includes("projects")) {
      const ids = [...new Set([...projectIds, ...(projectId ? [projectId] : [])])];
      bundle.projects = ids.map((id) => ({ projectId: id, settings: this.settingsRepository.getProjectSettings(id) }));
    }
    if (includedScopes.includes("sprints")) {
      const ids = [...new Set([...sprintIds, ...(sprintId ? [sprintId] : [])])];
      if (ids.length > 0 && !projectId) {
        throw managementValidationError("projectId is required when exporting sprint settings", "projectId");
      }
      bundle.sprints = ids.map((id) => ({ projectId: projectId!, sprintId: id, settings: this.settingsRepository.getSprintSettings(id) }));
    }

    const metadata = buildBundleMetadata(bundle, includedScopes);
    if (includeSecrets && metadata.containsSecrets) {
      const approval = this.requireSettingsApproval(args, payload);
      if (approval) return approval;
    }

    const resultBundle: SettingsBundle = {
      metadata,
      ...(
        includeSecrets
          ? bundle
          : redactSecretValues(bundle) as Omit<SettingsBundle, "metadata">
      ),
    };
    return { result: { bundle: resultBundle } };
  }

  private applySettingsBundle(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const bundle = parseBundle(payload);
    const applyScopes = normalizeScopes(payload.scopes, bundle.metadata.includedScopes);
    const containsSecrets = hasSecretValue(bundle) || bundle.metadata.containsSecrets;
    if (containsSecrets) {
      const approval = this.requireSettingsApproval(args, payload);
      if (approval) return approval;
    }

    const applied: Record<SettingsBundleScope, number> = {
      system: 0,
      projects: 0,
      sprints: 0,
    };

    if (applyScopes.includes("system") && bundle.system) {
      this.settingsRepository.saveSystemSettings(bundle.system);
      applied.system = 1;
    }
    if (applyScopes.includes("projects")) {
      for (const entry of bundle.projects ?? []) {
        this.settingsRepository.saveProjectSettings(entry.projectId, entry.settings);
        applied.projects += 1;
      }
    }
    if (applyScopes.includes("sprints")) {
      for (const entry of bundle.sprints ?? []) {
        const baseProjectSettings = this.settingsRepository.getProjectResolvedSettings(entry.projectId);
        this.settingsRepository.saveSprintSettings(entry.sprintId, baseProjectSettings, entry.settings);
        applied.sprints += 1;
      }
    }

    return {
      result: {
        success: true,
        applied,
        metadata: {
          schemaVersion: bundle.metadata.schemaVersion,
          exportedAt: bundle.metadata.exportedAt,
          includedScopes: bundle.metadata.includedScopes,
          fingerprint: bundle.metadata.fingerprint,
          containsSecrets,
        },
      },
    };
  }
}
