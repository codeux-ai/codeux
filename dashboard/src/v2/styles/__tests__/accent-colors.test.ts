import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DASHBOARD_ACCENT_COLORS } from "../../../../../src/repositories/settings-defaults.js";
import { ACCENT_COLOR_PRESETS } from "../../lib/accent-colors.js";

const globalsCss = readFileSync(resolve(process.cwd(), "dashboard/src/v2/styles/globals.css"), "utf8");

describe("dashboard accent color tokens", () => {
  it("keeps the settings palette aligned with the persisted allowlist", () => {
    expect(ACCENT_COLOR_PRESETS.map((preset) => preset.id)).toEqual(DASHBOARD_ACCENT_COLORS);
  });

  it("maps every custom preset to light and dark semantic signal variables", () => {
    for (const preset of DASHBOARD_ACCENT_COLORS.filter((id) => id !== "CODEUX")) {
      const selector = preset.toLowerCase();
      expect(globalsCss).toContain(`:root[data-accent="${selector}"]`);
      expect(globalsCss).toContain(`:root.dark[data-accent="${selector}"]`);
    }
  });

  it("exposes semantic action aliases while retaining signal compatibility", () => {
    expect(globalsCss).toContain("--accent-action: var(--signal-600);");
    expect(globalsCss).toContain("--accent-action-hover: var(--signal-700);");
    expect(globalsCss).toContain("--accent-action-rgb: var(--signal-rgb);");
    expect(globalsCss).toContain("--accent-on-solid: #ffffff;");
    expect(globalsCss).toContain("--accent-focus-ring: var(--accent-primary);");
  });
});
