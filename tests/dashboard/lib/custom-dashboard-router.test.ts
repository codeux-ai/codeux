import { describe, expect, it } from "vitest";
import {
  buildCustomDashboardLocation,
  getCustomDashboardRoutes,
  isCustomDashboardRouteDeclared,
  normalizeCustomDashboardPath,
  readCustomDashboardLocation,
  selectCustomDashboardRoute,
} from "../../../dashboard/src/v2/lib/custom-dashboard-router.js";

describe("custom dashboard router", () => {
  it("normalizes local paths without schemes, queries, fragments, or traversal", () => {
    expect(normalizeCustomDashboardPath("reports//weekly/?token=hidden#part")).toBe("/reports/weekly");
    expect(normalizeCustomDashboardPath("/reports/../overview")).toBe("/overview");
  });

  it("round-trips route-aware viewer deep links", () => {
    const url = buildCustomDashboardLocation({ dashboardId: "dashboard 1", mode: "viewer", routePath: "/release health" }, "http://localhost:4444");
    expect(url.toString()).toBe("http://localhost:4444/custom-dashboards?dashboard=dashboard+1&mode=viewer&route=%2Frelease+health");
    expect(readCustomDashboardLocation(url.search)).toEqual({ dashboardId: "dashboard 1", mode: "viewer", routePath: "/release health" });
  });

  it("selects an exact route then falls back to root", () => {
    const routes = [
      { path: "/", label: "Overview", entryFile: "src/main.tsx" },
      { path: "/logs", label: "Logs", entryFile: "src/logs.tsx" },
    ];
    expect(selectCustomDashboardRoute(routes, "//logs/")?.label).toBe("Logs");
    expect(selectCustomDashboardRoute(routes, "/missing")?.label).toBe("Overview");
  });

  it("falls back to the first declaration and preserves a route-less root entry", () => {
    const routes = [
      { path: "/details", label: "Details", entryFile: "src/details.tsx" },
      { path: "/activity", label: "Activity", entryFile: "src/activity.tsx" },
    ];
    expect(selectCustomDashboardRoute(routes, "/missing")?.path).toBe("/details");
    expect(getCustomDashboardRoutes([], "src/main.tsx")).toEqual([
      { path: "/", label: "Overview", entryFile: "src/main.tsx" },
    ]);
    expect(selectCustomDashboardRoute([], "/missing", "src/main.tsx")?.path).toBe("/");
    expect(isCustomDashboardRouteDeclared(routes, "/details")).toBe(true);
    expect(isCustomDashboardRouteDeclared(routes, "/missing")).toBe(false);
  });
});
