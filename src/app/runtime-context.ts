import type { DashboardSettings, DashboardStatus, Settings } from "../contracts/app-types.js";

export interface RuntimeContext {
  settings: Settings;
  dashboardSettings: DashboardSettings | undefined;
  consecutiveFailures: number;
  lastStatus: Partial<DashboardStatus> | null;
  dashboardRuntimePort: number | null;
}

export class DefaultRuntimeContext implements RuntimeContext {
  private _settings: Settings = { maxFailures: 5 };
  private _dashboardSettings: DashboardSettings | undefined = undefined;
  private _consecutiveFailures: number = 0;
  private _lastStatus: Partial<DashboardStatus> | null = { subtasks: [], timestamp: null };
  private _dashboardRuntimePort: number | null = null;

  get settings(): Settings {
    return this._settings;
  }

  set settings(value: Settings) {
    this._settings = value;
  }

  get dashboardSettings(): DashboardSettings | undefined {
    return this._dashboardSettings;
  }

  set dashboardSettings(value: DashboardSettings | undefined) {
    this._dashboardSettings = value;
  }

  get consecutiveFailures(): number {
    return this._consecutiveFailures;
  }

  set consecutiveFailures(value: number) {
    this._consecutiveFailures = value;
  }

  get lastStatus(): Partial<DashboardStatus> | null {
    return this._lastStatus;
  }

  set lastStatus(value: Partial<DashboardStatus> | null) {
    this._lastStatus = value;
  }

  get dashboardRuntimePort(): number | null {
    return this._dashboardRuntimePort;
  }

  set dashboardRuntimePort(value: number | null) {
    this._dashboardRuntimePort = value;
  }
}
