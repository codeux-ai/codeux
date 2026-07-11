import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const mainSource = readFileSync(join(repoRoot, "dashboard/src/main.tsx"), "utf8");
const removedWidgetPath = join(
  repoRoot,
  "dashboard/src/v2/components/chat/DashboardAssistantWidget.tsx",
);

describe("dashboard shell chat entry point", () => {
  it("does not mount the obsolete floating assistant overlay", () => {
    expect(mainSource).not.toContain("DashboardAssistantWidget");
    expect(mainSource).not.toContain('aria-label="Dashboard assistant"');
    expect(existsSync(removedWidgetPath)).toBe(false);
  });

  it("keeps the dedicated Chat page route mounted", () => {
    expect(mainSource).toContain('lazy(() => import("./v2/ChatPage.js")');
    expect(mainSource).toMatch(/const chatRoute = createRoute\(\{[\s\S]*?path: "\/chat",[\s\S]*?component: ChatPage,/);
  });
});
