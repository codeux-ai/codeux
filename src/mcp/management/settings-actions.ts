import type { ManageSprintOsArgs, ManagementResponseEnvelope } from "../../contracts/internal-management-types.js";
import type { SettingsRepository } from "../../repositories/settings-repository.js";
import { SettingsPathUpdater } from "../../services/settings-path-updater.js";
import type { SystemSettings, ProjectSettingsOverride, SprintSettingsOverride } from "../../contracts/settings-scope-types.js";

export class SettingsActions {
  constructor(private readonly settingsRepository: SettingsRepository) {}

  async handleSettingsAction(args: ManageSprintOsArgs): Promise<ManagementResponseEnvelope> {
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
        return this.patchSystemSetting(payload);
      case "replace_project_settings":
        return this.replaceProjectSettings(args, payload);
      case "patch_project_setting":
        return this.patchProjectSetting(payload);
      case "reset_project_settings":
        return this.resetProjectSettings(args, payload);
      case "replace_sprint_settings":
        return this.replaceSprintSettings(args, payload);
      case "patch_sprint_setting":
        return this.patchSprintSetting(payload);
      case "reset_sprint_settings":
        return this.resetSprintSettings(args, payload);
      default:
        throw new Error(`Unknown settings action: ${args.action}`);
    }
  }

  private getSystemSettings(): ManagementResponseEnvelope {
    return { result: { settings: this.settingsRepository.getSystemSettings() } };
  }

  private getProjectOverride(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    if (!projectId) throw new Error("projectId is required");
    return { result: { override: this.settingsRepository.getProjectSettings(projectId) } };
  }

  private resolveProjectEffective(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    if (!projectId) throw new Error("projectId is required");
    return { result: { settings: this.settingsRepository.resolveProjectDashboardSettings(projectId) } };
  }

  private getSprintOverride(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const sprintId = typeof payload.sprintId === "string" ? payload.sprintId : undefined;
    if (!sprintId) throw new Error("sprintId is required");
    return { result: { override: this.settingsRepository.getSprintSettings(sprintId) } };
  }

  private resolveSprintEffective(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    const sprintId = typeof payload.sprintId === "string" ? payload.sprintId : undefined;
    if (!projectId || !sprintId) throw new Error("projectId and sprintId are required");
    return { result: { settings: this.settingsRepository.resolveSprintDashboardSettings(projectId, sprintId) } };
  }

  private replaceSystemSettings(args: ManageSprintOsArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    if (args.approval?.confirmed !== true) {
      return { approvalRequired: true, approvalMessage: "Are you sure you want to replace all system settings?" };
    }
    const settings = payload.settings as SystemSettings;
    if (!settings) throw new Error("settings object is required");
    return { result: { settings: this.settingsRepository.saveSystemSettings(settings) } };
  }

  private patchSystemSetting(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const path = typeof payload.path === "string" ? payload.path : undefined;
    const value = payload.value;
    if (!path) throw new Error("path is required");

    const current = this.settingsRepository.getSystemSettings();
    const updated = SettingsPathUpdater.patchObject(current, path, value);
    return { result: { settings: this.settingsRepository.saveSystemSettings(updated) } };
  }

  private replaceProjectSettings(args: ManageSprintOsArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    if (!projectId) throw new Error("projectId is required");
    if (args.approval?.confirmed !== true) {
      return { approvalRequired: true, approvalMessage: `Are you sure you want to replace settings for project ${projectId}?` };
    }
    const settings = payload.settings as ProjectSettingsOverride;
    if (!settings) throw new Error("settings object is required");
    return { result: { settings: this.settingsRepository.saveProjectSettings(projectId, settings) } };
  }

  private patchProjectSetting(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    const path = typeof payload.path === "string" ? payload.path : undefined;
    const value = payload.value;
    if (!projectId || !path) throw new Error("projectId and path are required");

    const current = this.settingsRepository.getProjectSettings(projectId);
    const updated = SettingsPathUpdater.patchObject(current, path, value);
    return { result: { settings: this.settingsRepository.saveProjectSettings(projectId, updated) } };
  }

  private resetProjectSettings(args: ManageSprintOsArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    if (!projectId) throw new Error("projectId is required");
    if (args.approval?.confirmed !== true) {
      return { approvalRequired: true, approvalMessage: `Are you sure you want to reset settings for project ${projectId}?` };
    }
    this.settingsRepository.resetProjectSettings(projectId);
    return { result: { success: true } };
  }

  private replaceSprintSettings(args: ManageSprintOsArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    const sprintId = typeof payload.sprintId === "string" ? payload.sprintId : undefined;
    if (!projectId || !sprintId) throw new Error("projectId and sprintId are required");
    if (args.approval?.confirmed !== true) {
      return { approvalRequired: true, approvalMessage: `Are you sure you want to replace settings for sprint ${sprintId}?` };
    }
    const settings = payload.settings as SprintSettingsOverride;
    if (!settings) throw new Error("settings object is required");

    const baseProjectSettings = this.settingsRepository.getProjectResolvedSettings(projectId);
    return { result: { settings: this.settingsRepository.saveSprintSettings(sprintId, baseProjectSettings, settings) } };
  }

  private patchSprintSetting(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    const sprintId = typeof payload.sprintId === "string" ? payload.sprintId : undefined;
    const path = typeof payload.path === "string" ? payload.path : undefined;
    const value = payload.value;
    if (!projectId || !sprintId || !path) throw new Error("projectId, sprintId, and path are required");

    const current = this.settingsRepository.getSprintSettings(sprintId);
    const updated = SettingsPathUpdater.patchObject(current, path, value);
    const baseProjectSettings = this.settingsRepository.getProjectResolvedSettings(projectId);

    return { result: { settings: this.settingsRepository.saveSprintSettings(sprintId, baseProjectSettings, updated) } };
  }

  private resetSprintSettings(args: ManageSprintOsArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const sprintId = typeof payload.sprintId === "string" ? payload.sprintId : undefined;
    if (!sprintId) throw new Error("sprintId is required");
    if (args.approval?.confirmed !== true) {
      return { approvalRequired: true, approvalMessage: `Are you sure you want to reset settings for sprint ${sprintId}?` };
    }
    this.settingsRepository.resetSprintSettings(sprintId);
    return { result: { success: true } };
  }
}
