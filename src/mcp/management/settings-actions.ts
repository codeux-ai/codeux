import type { ManageCodeUxArgs, ManagementResponseEnvelope } from "../../contracts/internal-management-types.js";
import type { SettingsRepository } from "../../repositories/settings-repository.js";
import { SettingsPathUpdater } from "../../services/settings-path-updater.js";
import type { SystemSettings, ProjectSettingsOverride, SprintSettingsOverride } from "../../contracts/settings-scope-types.js";
import {
  parseRequiredObject,
  parseRequiredPresentValue,
  parseRequiredString as readRequiredString,
} from "./payload-parsers.js";

const SETTINGS_APPROVAL_TTL_MS = 15 * 60 * 1000;
const SETTINGS_APPROVAL_MESSAGE = [
  "Settings change queued and waiting for human confirmation.",
  "Ask the user to confirm this exact settings change before calling the tool again.",
  "DO NOT call this settings endpoint again with approval.confirmed: true unless the user explicitly confirms.",
  "This approval is one-use, bound to this exact action and payload, and expires in 15 minutes.",
].join(" ");

function normalizeForApproval(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForApproval(item));
  }
  if (typeof value === "object" && value !== null) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((normalized, key) => {
        const nextValue = (value as Record<string, unknown>)[key];
        if (nextValue !== undefined) {
          normalized[key] = normalizeForApproval(nextValue);
        }
        return normalized;
      }, {});
  }
  return value;
}

function normalizeSettingsPayloadForApproval(payload: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(payload).sort()) {
    if (key === "action" || key === "approval" || key === "domain") {
      continue;
    }
    const value = payload[key];
    if (value !== undefined) {
      normalized[key] = normalizeForApproval(value);
    }
  }
  return normalized;
}

function buildSettingsApprovalFingerprint(action: string, payload: Record<string, unknown>): string {
  return JSON.stringify({
    domain: "settings",
    action,
    payload: normalizeSettingsPayloadForApproval(payload),
  });
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

    const fingerprint = buildSettingsApprovalFingerprint(args.action, payload);
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
}
