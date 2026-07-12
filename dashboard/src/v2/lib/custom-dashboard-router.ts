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
): CustomDashboardRouteDefinition | null {
  const normalized = normalizeCustomDashboardPath(routePath);
  return routes.find((route) => normalizeCustomDashboardPath(route.path) === normalized)
    ?? routes.find((route) => normalizeCustomDashboardPath(route.path) === "/")
    ?? routes[0]
    ?? null;
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
