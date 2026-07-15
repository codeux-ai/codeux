import { expect, test, type Page } from "@playwright/test";
import type { ProjectSummary } from "../../../src/contracts/project-management-types.js";
import { completeOnboarding, ensureSelectedProject, suppressDashboardTour } from "../helpers/prepare-app";
import { createSlackFixtureConnection, installDeliveryFixtureBoundary } from "./chat-connectors-test-api";

const providers = ["WhatsApp", "iMessage", "Telegram", "Slack", "Microsoft Teams", "Discord"] as const;

async function openIntegrations(page: Page): Promise<void> {
  await page.goto("/config");
  await page.evaluate(() => {
    window.sessionStorage.setItem("codeux:settings-navigation:v1", JSON.stringify({
      activeCategory: "integrations",
      activeInvocationRoute: "task_coding",
      focusedSections: {},
    }));
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings & Integration" })).toBeVisible();
  await expect(page.locator('[data-active-category="integrations"]')).toBeVisible();
}

test.describe("settings chat connector acceptance", () => {
  let project: ProjectSummary;
  let connectionId: string | null = null;

  test.beforeEach(async ({ page, request }, testInfo) => {
    connectionId = null;
    await completeOnboarding(request);
    project = await ensureSelectedProject(request, { testInfo, fixtureKey: "chat-connectors" });
    const settingsResponse = await request.get("/api/system-settings");
    expect(settingsResponse.ok()).toBe(true);
    const settings = await settingsResponse.json() as { defaults: { appearance: { reducedMotion: string } } } & Record<string, unknown>;
    settings.defaults.appearance.reducedMotion = "REDUCE";
    const saved = await request.put("/api/system-settings", { data: settings });
    expect(saved.ok(), await saved.text()).toBe(true);
    await suppressDashboardTour(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test.afterEach(async ({ request }) => {
    if (!connectionId) return;
    const response = await request.delete(`/api/chat-providers/connections/${encodeURIComponent(connectionId)}`);
    expect(response.ok() || response.status() === 404, await response.text()).toBe(true);
    connectionId = null;
  });

  test("loads every provider and completes validation, verification, binding, delivery controls, focus, and mobile flows", async ({ page, request }) => {
    expect(project.id).toBeTruthy();
    const connection = await createSlackFixtureConnection(request);
    connectionId = connection.id;
    await page.route(`**/api/projects/${project.id}/settings/effective`, async (route) => {
      const response = await route.fetch();
      const body = await response.json() as { settings?: { appearance?: { reducedMotion?: string } } };
      if (body.settings?.appearance) body.settings.appearance.reducedMotion = "REDUCE";
      await route.fulfill({ response, json: body });
    });
    await installDeliveryFixtureBoundary(page, connection.id);
    await openIntegrations(page);
    await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");

    for (const provider of providers) {
      const card = page.getByRole("article", { name: `${provider} chat connector` });
      await expect(card).toBeVisible();
    }

    await page.getByRole("article", { name: "Slack chat connector" }).getByRole("button", { name: "Manage Slack" }).dispatchEvent("click");
    await expect(page.getByRole("heading", { name: "Slack Connector" })).toBeVisible();
    await expect(page.getByText("Slack setup guidance")).toBeVisible();
    const editor = page.getByRole("region", { name: "Slack acceptance fixture connection editor" });
    await expect(editor).toBeVisible();

    await editor.getByRole("button", { name: "Test connection" }).click();
    await expect(editor.getByRole("region", { name: "Slack acceptance fixture verification result" })).toContainText("Verified");

    const displayName = editor.getByRole("textbox", { name: "Slack acceptance fixture display name" });
    await displayName.fill("");
    await editor.getByRole("button", { name: "Save connection" }).click();
    await expect(editor.getByRole("alert")).toContainText("Display name is required.");
    await displayName.fill("Slack acceptance fixture");

    const channelId = editor.getByRole("textbox", { name: "Slack acceptance fixture new binding channel id" });
    await channelId.fill("C-BROWSER-FIXTURE");
    await editor.getByRole("button", { name: "Create binding" }).click();
    await expect(editor.getByRole("region", { name: "C-BROWSER-FIXTURE channel binding" })).toBeVisible();

    const retry = editor.getByRole("button", { name: "Retry", exact: true });
    await retry.focus();
    await retry.click();
    await expect(page.getByRole("dialog", { name: "Retry delivery?" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Retry delivery?" })).toHaveCount(0);
    await expect(retry).toBeFocused();
    await retry.click();
    await page.getByRole("dialog", { name: "Retry delivery?" }).getByRole("button", { name: "Retry delivery" }).click();
    await expect(page.getByText("Delivery retry completed.")).toBeVisible();
    await expect(editor.getByText("Delivered", { exact: true })).toBeVisible();

    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    const cancelDialog = page.getByRole("dialog", { name: "Cancel delivery?" });
    await expect(cancelDialog).toContainText("cannot recall a message already accepted");
    await cancelDialog.getByRole("button", { name: "Cancel delivery" }).click();
    await expect(page.getByText("Delivery cancelled.")).toBeVisible();
    await expect(editor.getByText("Cancelled", { exact: true })).toBeVisible();

    await editor.getByRole("button", { name: "Inspect", exact: true }).first().click();
    await expect(page.getByText(/Bearer \[redacted\].*\[redacted URL\]/)).toBeVisible();
    await expect(page.getByText("fixture-secret-value", { exact: false })).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(editor.getByRole("button", { name: "Save connection" })).toBeVisible();
    await expect(editor.getByRole("button", { name: "Create binding" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
