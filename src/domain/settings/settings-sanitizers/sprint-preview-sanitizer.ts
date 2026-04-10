import type { ProjectSettings } from "../../../contracts/settings-scope-types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../repositories/settings-defaults.js";

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function sanitizeSprintPreviewSettings(value: unknown): ProjectSettings["sprintPreview"] {
  const input = toRecord(value);
  const defaults = DEFAULT_DASHBOARD_SETTINGS.sprintPreview;
  const hostPortRangeStart = typeof input.hostPortRangeStart === "number" && Number.isFinite(input.hostPortRangeStart)
    ? Math.max(1, Math.min(65535, Math.round(input.hostPortRangeStart)))
    : defaults.hostPortRangeStart;
  const hostPortRangeEndCandidate = typeof input.hostPortRangeEnd === "number" && Number.isFinite(input.hostPortRangeEnd)
    ? Math.max(1, Math.min(65535, Math.round(input.hostPortRangeEnd)))
    : defaults.hostPortRangeEnd;

  return {
    enabled: typeof input.enabled === "boolean"
      ? input.enabled
      : defaults.enabled,
    showInAppBrowser: typeof input.showInAppBrowser === "boolean"
      ? input.showInAppBrowser
      : defaults.showInAppBrowser,
    autoStartOnRunningSprint: typeof input.autoStartOnRunningSprint === "boolean"
      ? input.autoStartOnRunningSprint
      : defaults.autoStartOnRunningSprint,
    rebuildOnTaskCompletion: typeof input.rebuildOnTaskCompletion === "boolean"
      ? input.rebuildOnTaskCompletion
      : defaults.rebuildOnTaskCompletion,
    rebuildOnSprintCompletion: typeof input.rebuildOnSprintCompletion === "boolean"
      ? input.rebuildOnSprintCompletion
      : defaults.rebuildOnSprintCompletion,
    autoStopOnTerminalSprint: typeof input.autoStopOnTerminalSprint === "boolean"
      ? input.autoStopOnTerminalSprint
      : defaults.autoStopOnTerminalSprint,
    maxConcurrentContainers: typeof input.maxConcurrentContainers === "number" && Number.isFinite(input.maxConcurrentContainers)
      ? Math.max(1, Math.min(100, Math.round(input.maxConcurrentContainers)))
      : defaults.maxConcurrentContainers,
    hostPortRangeStart,
    hostPortRangeEnd: Math.max(hostPortRangeStart, hostPortRangeEndCandidate),
    containerAppPort: typeof input.containerAppPort === "number" && Number.isFinite(input.containerAppPort)
      ? Math.max(1, Math.min(65535, Math.round(input.containerAppPort)))
      : defaults.containerAppPort,
    startupScriptPath: typeof input.startupScriptPath === "string" && input.startupScriptPath.trim().length > 0
      ? input.startupScriptPath.trim()
      : defaults.startupScriptPath,
  };
}
