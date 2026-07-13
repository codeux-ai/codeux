import type { CustomDashboardRouteDefinition } from "../types.js";

export type CustomDashboardPageMode = "editor" | "viewer";

export interface CustomDashboardLocationState {
  dashboardId: string | null;
  mode: CustomDashboardPageMode;
  routePath: string;
}

export function normalizeCustomDashboardPath(value: string | null | undefined): string {
  const raw = (value ?? "/").trim().split(/[?#]/, 1)[0] ?? "/";
  const segments = raw.replace(/\\/g, "/").split("/").filter(Boolean);
  const normalized: string[] = [];
  for (const segment of segments) {
    if (segment === ".") continue;
    if (segment === "..") normalized.pop();
    else normalized.push(segment);
  }
  return `/${normalized.join("/")}`;
}

export function readCustomDashboardLocation(search = globalThis.location?.search ?? ""): CustomDashboardLocationState {
  const params = new URLSearchParams(search);
  return {
    dashboardId: params.get("dashboard"),
    mode: params.get("mode") === "viewer" ? "viewer" : "editor",
    routePath: normalizeCustomDashboardPath(params.get("route")),
  };
}

export function buildCustomDashboardLocation(
  state: CustomDashboardLocationState,
  origin = globalThis.location?.origin ?? "http://localhost",
): URL {
  const url = new URL("/custom-dashboards", origin);
  if (state.dashboardId) url.searchParams.set("dashboard", state.dashboardId);
  if (state.mode === "viewer") url.searchParams.set("mode", "viewer");
  const routePath = normalizeCustomDashboardPath(state.routePath);
  if (state.mode === "viewer" && routePath !== "/") url.searchParams.set("route", routePath);
  return url;
}

export function selectCustomDashboardRoute(
  routes: CustomDashboardRouteDefinition[],
  routePath: string,
  fallbackEntryFile?: string,
): CustomDashboardRouteDefinition | null {
  const normalized = normalizeCustomDashboardPath(routePath);
  const normalizedRoutes = getCustomDashboardRoutes(routes, fallbackEntryFile);
  return normalizedRoutes.find((route) => route.path === normalized)
    ?? normalizedRoutes.find((route) => route.path === "/")
    ?? normalizedRoutes[0]
    ?? null;
}

export function getCustomDashboardRoutes(
  routes: CustomDashboardRouteDefinition[],
  fallbackEntryFile?: string,
): CustomDashboardRouteDefinition[] {
  if (routes.length === 0) {
    return fallbackEntryFile
      ? [{ path: "/", label: "Overview", entryFile: fallbackEntryFile }]
      : [];
  }
  return routes.map((route) => ({
    ...route,
    path: normalizeCustomDashboardPath(route.path),
  }));
}

export function isCustomDashboardRouteDeclared(
  routes: CustomDashboardRouteDefinition[],
  routePath: string,
  fallbackEntryFile?: string,
): boolean {
  const normalized = normalizeCustomDashboardPath(routePath);
  return getCustomDashboardRoutes(routes, fallbackEntryFile).some((route) => route.path === normalized);
}

export function updateCustomDashboardHistory(
  state: CustomDashboardLocationState,
  options: { replace?: boolean } = {},
): void {
  if (typeof window === "undefined") return;
  const url = buildCustomDashboardLocation(state, window.location.origin);
  window.history[options.replace ? "replaceState" : "pushState"](
    { codeUxCustomDashboard: state },
    "",
    `${url.pathname}${url.search}`,
  );
}
