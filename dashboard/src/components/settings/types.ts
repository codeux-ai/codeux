import type { DashboardSettings } from "../../types.js";

export interface SettingsSectionProps {
  settings: DashboardSettings;
  onChange: (next: DashboardSettings) => void;
}
