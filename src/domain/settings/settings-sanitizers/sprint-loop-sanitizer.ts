import type { DashboardSettings } from "../../../contracts/app-types.js";
import { readBoolean, readInteger } from "../../../shared/config/value-readers.js";
import {
  DEFAULT_DASHBOARD_SETTINGS,
  MAX_WATCH_LOOP_INTERVAL_SECONDS,
  MAX_WATCH_LOOP_OUTPUT_INTERVAL_SECONDS,
  MIN_WATCH_LOOP_INTERVAL_SECONDS,
  MIN_WATCH_LOOP_OUTPUT_INTERVAL_SECONDS,
} from "../../../repositories/settings-defaults.js";

export const sanitizeSprintLoopSteps = (
  input: Partial<DashboardSettings> | undefined
): DashboardSettings["sprintLoopSteps"] => {
  const loopInput = (input?.sprintLoopSteps && typeof input.sprintLoopSteps === "object"
    ? input.sprintLoopSteps
    : {}) as Partial<DashboardSettings["sprintLoopSteps"]>;

  return {
    branchPreflight: readBoolean(loopInput.branchPreflight, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.branchPreflight),
    planningPreflight: readBoolean(loopInput.planningPreflight, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.planningPreflight),
    loadSubtasks: readBoolean(loopInput.loadSubtasks, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.loadSubtasks),
    sessionSync: readBoolean(loopInput.sessionSync, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.sessionSync),
    statusDerivation: readBoolean(loopInput.statusDerivation, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.statusDerivation),
    startReadyTasks: readBoolean(loopInput.startReadyTasks, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.startReadyTasks),
    mergeProtocol: readBoolean(loopInput.mergeProtocol, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.mergeProtocol),
    actionRequiredProtocol: readBoolean(loopInput.actionRequiredProtocol, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.actionRequiredProtocol),
    statusTable: readBoolean(loopInput.statusTable, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.statusTable),
    watchLoop: readBoolean(loopInput.watchLoop, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.watchLoop),
    watchLoopIntervalSeconds: Math.min(
      MAX_WATCH_LOOP_INTERVAL_SECONDS,
      Math.max(
        MIN_WATCH_LOOP_INTERVAL_SECONDS,
        readInteger(loopInput.watchLoopIntervalSeconds, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.watchLoopIntervalSeconds)
      )
    ),
    watchLoopOutputIntervalSeconds: Math.min(
      MAX_WATCH_LOOP_OUTPUT_INTERVAL_SECONDS,
      Math.max(
        MIN_WATCH_LOOP_OUTPUT_INTERVAL_SECONDS,
        readInteger(
          loopInput.watchLoopOutputIntervalSeconds,
          DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.watchLoopOutputIntervalSeconds
        )
      )
    ),
  };
};
