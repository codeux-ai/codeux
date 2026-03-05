import type { DashboardSettings, ExternalSettingsHints } from "../contracts/app-types.js";
import { SettingsDbStorage } from "./settings-db-storage.js";
import { cloneDefaults, sanitizeSettings } from "./settings-sanitizer.js";
import { SettingsValidationError, validateSettingsPayload } from "../domain/settings/settings-schema.js";

export { DEFAULT_DASHBOARD_SETTINGS } from "./settings-defaults.js";

export class SettingsRepository {
  private readonly storage: SettingsDbStorage;
  private readonly externalHints: ExternalSettingsHints | undefined;

  constructor(dbPath?: string, externalHints?: ExternalSettingsHints) {
    this.storage = new SettingsDbStorage(dbPath);
    this.externalHints = externalHints;
  }

  getSettings(): DashboardSettings {
    const payload = this.storage.readPayload();
    if (!payload) {
      return cloneDefaults(this.externalHints);
    }

    try {
      const parsed = JSON.parse(payload) as unknown;
      return sanitizeSettings(parsed, this.externalHints);
    } catch {
      return cloneDefaults(this.externalHints);
    }
  }

  saveSettings(input: DashboardSettings): DashboardSettings {
    const validationResult = validateSettingsPayload(input);
    if (!validationResult.success) {
      throw new SettingsValidationError(validationResult.issues);
    }
    const normalized = sanitizeSettings(input, this.externalHints);
    this.storage.writePayload(JSON.stringify(normalized));
    return normalized;
  }
}
