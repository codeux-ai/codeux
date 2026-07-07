import type { LucideIcon } from "lucide-preact";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  Compass,
  Cpu,
  FolderTree,
  GitBranch,
  Hexagon,
  Inbox,
  Layers,
  LayoutDashboard,
  Library,
  ListChecks,
  MessageCircle,
  Settings,
  Zap,
} from "lucide-preact";
import type { DashboardExperienceMode } from "../../types.js";
import { normalizeDashboardExperienceMode } from "./experience-mode.js";

export const EXTERNAL_DOCS_URL = "https://github.com/codeux-ai/codeux#readme";

export type NavigationItemId =
  | "chat"
  | "overview"
  | "sprints"
  | "tasks"
  | "agents"
  | "nodes"
  | "custom-dashboards"
  | "stats"
  | "scheduler"
  | "memory"
  | "knowledge"
  | "browser"
  | "files"
  | "live"
  | "docs"
  | "config";

export type NavigationItemGroup = "workspace" | "utility";
export type NavigationDockSection = "left" | "right";
export type NavigationSurface = "dock" | "sidebar";

interface BaseNavigationItem {
  id: NavigationItemId;
  icon: LucideIcon;
  label: string;
  dockLabel?: string;
  color: string;
  group: NavigationItemGroup;
  dockSection: NavigationDockSection;
  tourId: string;
}

export interface RouteNavigationItem extends BaseNavigationItem {
  kind: "route";
  path: string;
}

export interface ExternalNavigationItem extends BaseNavigationItem {
  kind: "external";
  href: string;
}

export type NavigationItem = RouteNavigationItem | ExternalNavigationItem;
export type PrimaryNavigationItem = NavigationItem & {
  unavailableReason?: string;
};

interface GetPrimaryNavigationItemsOptions {
  browserVisible?: boolean;
  unavailableBrowserReason?: string;
}

export const ALL_NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { id: "chat", icon: MessageCircle, label: "Chat", path: "/chat", color: "text-signal-400", group: "workspace", dockSection: "left", tourId: "nav-chat", kind: "route" },
  { id: "overview", icon: Hexagon, label: "Overview", path: "/", color: "text-signal-500", group: "workspace", dockSection: "right", tourId: "nav-overview", kind: "route" },
  { id: "sprints", icon: Layers, label: "Sprints", path: "/sprints", color: "text-ember-500", group: "workspace", dockSection: "right", tourId: "nav-sprints", kind: "route" },
  { id: "tasks", icon: ListChecks, label: "Tasks", path: "/tasks", color: "text-signal-400", group: "workspace", dockSection: "right", tourId: "nav-tasks", kind: "route" },
  { id: "agents", icon: Cpu, label: "Agents", path: "/agents", color: "text-signal-400", group: "workspace", dockSection: "right", tourId: "nav-agents", kind: "route" },
  { id: "nodes", icon: GitBranch, label: "Nodes", path: "/nodes", color: "text-signal-500", group: "workspace", dockSection: "right", tourId: "nav-nodes", kind: "route" },
  { id: "custom-dashboards", icon: LayoutDashboard, label: "Dashboards", dockLabel: "Dash", path: "/custom-dashboards", color: "text-signal-500", group: "workspace", dockSection: "right", tourId: "nav-custom-dashboards", kind: "route" },
  { id: "stats", icon: BarChart3, label: "Stats", path: "/stats", color: "text-signal-500", group: "workspace", dockSection: "right", tourId: "nav-stats", kind: "route" },
  { id: "scheduler", icon: CalendarDays, label: "Schedule", path: "/scheduler", color: "text-signal-500", group: "workspace", dockSection: "right", tourId: "nav-schedule", kind: "route" },
  { id: "memory", icon: Inbox, label: "Memory", path: "/memory", color: "text-signal-500", group: "workspace", dockSection: "right", tourId: "nav-memory", kind: "route" },
  { id: "knowledge", icon: Library, label: "Knowledge", path: "/knowledge", color: "text-signal-500", group: "workspace", dockSection: "right", tourId: "nav-knowledge", kind: "route" },
  { id: "browser", icon: Compass, label: "Browser", path: "/browser", color: "text-signal-500", group: "workspace", dockSection: "right", tourId: "nav-browser", kind: "route" },
  { id: "files", icon: FolderTree, label: "Files", path: "/files", color: "text-signal-500", group: "workspace", dockSection: "right", tourId: "nav-files", kind: "route" },
  { id: "live", icon: Zap, label: "Live", path: "/live", color: "text-signal-500", group: "workspace", dockSection: "right", tourId: "nav-live", kind: "route" },
  { id: "docs", icon: BookOpen, label: "Docs", href: EXTERNAL_DOCS_URL, color: "text-signal-500", group: "utility", dockSection: "right", tourId: "nav-docs", kind: "external" },
  { id: "config", icon: Settings, label: "Settings", dockLabel: "Config", path: "/config", color: "text-slate-400 dark:text-slate-400", group: "utility", dockSection: "right", tourId: "nav-config", kind: "route" },
] as const;

const EASY_NAVIGATION_ITEM_IDS: readonly NavigationItemId[] = ["chat", "browser", "stats", "config", "docs"];
const STANDARD_NAVIGATION_ITEM_IDS: readonly NavigationItemId[] = [
  "chat",
  "overview",
  "sprints",
  "tasks",
  "agents",
  "nodes",
  "custom-dashboards",
  "stats",
  "browser",
  "docs",
  "config",
];
const EXPERT_NAVIGATION_ITEM_IDS: readonly NavigationItemId[] = ALL_NAVIGATION_ITEMS.map((item) => item.id);

const NAVIGATION_ITEM_IDS_BY_MODE: Record<DashboardExperienceMode, readonly NavigationItemId[]> = {
  EASY: EASY_NAVIGATION_ITEM_IDS,
  STANDARD: STANDARD_NAVIGATION_ITEM_IDS,
  EXPERT: EXPERT_NAVIGATION_ITEM_IDS,
};

const navigationItemById = new Map<NavigationItemId, NavigationItem>(
  ALL_NAVIGATION_ITEMS.map((item) => [item.id, item]),
);

export const isRouteNavigationItem = (item: PrimaryNavigationItem): item is RouteNavigationItem & { unavailableReason?: string } => (
  item.kind === "route"
);

export const getNavigationItemLabel = (item: PrimaryNavigationItem, surface: NavigationSurface): string => (
  surface === "dock" && item.dockLabel ? item.dockLabel : item.label
);

export const getPrimaryNavigationItems = (
  mode: DashboardExperienceMode | null | undefined,
  options: GetPrimaryNavigationItemsOptions = {},
): PrimaryNavigationItem[] => {
  const normalizedMode = normalizeDashboardExperienceMode(mode);
  const browserVisible = options.browserVisible ?? true;

  return NAVIGATION_ITEM_IDS_BY_MODE[normalizedMode]
    .map((id) => navigationItemById.get(id))
    .filter((item): item is NavigationItem => !!item)
    .flatMap((item): PrimaryNavigationItem[] => {
      if (item.id !== "browser" || browserVisible) {
        return [item];
      }
      if (options.unavailableBrowserReason && item.kind === "route") {
        return [{ ...item, unavailableReason: options.unavailableBrowserReason }];
      }
      return [];
    });
};
