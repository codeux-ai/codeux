import type { DashboardSettings } from "../../src/contracts/app-types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../src/repositories/settings-repository.js";

export function buildMockSettings(overrides: Partial<DashboardSettings> = {}): DashboardSettings {
  return {
    ...DEFAULT_DASHBOARD_SETTINGS,
    ...overrides,
  };
}
