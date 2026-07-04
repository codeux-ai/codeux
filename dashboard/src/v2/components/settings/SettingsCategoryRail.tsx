import type { FunctionComponent } from "preact";
import { useRef } from "preact/hooks";
import { Layers3 } from "lucide-preact";
import type { Category, CategoryId } from "../../hooks/use-settings-page-state.js";
import { NoticePanel } from "./SettingsSurface.js";
import { SHARED_INTERACTION_CLASSES } from "../ui/Button.js";

import { AlertTriangle, Banknote, Bot, BrainCircuit, Compass, Cpu, Monitor, Plug, Server, Settings, SlidersHorizontal, Target } from "lucide-preact";

export const CATEGORIES: Category[] = [
  { id: "general", num: "01", label: "General", icon: SlidersHorizontal, description: "Scope, runtime, and automation posture" },
  { id: "appearance", num: "02", label: "Appearance", icon: Monitor, description: "Dashboard layout and theme preferences" },
  { id: "models", num: "03", label: "AI Models", icon: Cpu, description: "Provider routing, models, and weighting" },
  { id: "modelPricing", num: "04", label: "Model Pricing", icon: Banknote, description: "Per-model token pricing from the catalogue, with your own overrides" },
  { id: "sprint", num: "05", label: "Sprint & Git", icon: Target, description: "Git flow, branch naming, merge rules, and execution runtime" },
  { id: "browser", num: "06", label: "Browser Preview", icon: Compass, description: "Preview runtime, browser visibility, and container policy" },
  { id: "agents", num: "07", label: "Agents", icon: Bot, description: "Project-local markdown mirrors and agent authoring behavior" },
  { id: "memory", num: "08", label: "Memory", icon: BrainCircuit, description: "Embedding models, auto-capture, and promotion policy" },
  { id: "integrations", num: "09", label: "Integrations", icon: Plug, description: "Provider keys, Git hosts, and external connection policy" },
  { id: "mcp", num: "10", label: "MCP", icon: Server, description: "MCP servers injected into CLIs and built-in tool access" },
  { id: "danger", num: "11", label: "Danger Zone", icon: AlertTriangle, description: "Reset project overrides only when needed", danger: true },
];

export const CATEGORY_SEARCH_HINTS: Record<CategoryId, string[]> = {
  general: ["automation", "scope", "runtime", "dashboard", "clarification", "pause", "resume"],
  appearance: ["theme", "layout", "dock", "sidebar", "light", "dark", "motion", "appearance"],
  models: ["provider", "routing", "model", "thinking", "worker", "codex", "gemini", "claude", "jules"],
  modelPricing: ["pricing", "price", "cost", "token", "catalogue", "override", "billing", "usage"],
  sprint: ["ci", "merge", "watch", "loop", "docker", "execution", "cleanup", "branch", "branch name", "branch naming", "branch scheme", "default branch", "feature branch", "git flow", "autofix", "browser", "preview", "container", "port"],
  browser: ["browser", "preview", "container", "port", "routing", "rebuild", "launch", "concurrent", "iframe"],
  agents: ["agent", "prompt", "template", "markdown", "instruction"],
  memory: ["memory", "embedding", "capture", "promotion", "learning"],
  integrations: ["github", "gitlab", "jira", "atlassian", "token", "api key", "auth", "credential", "integration"],
  mcp: ["mcp", "server", "tool", "tools", "custom mcp", "model context protocol", "code_ux", "toggle", "http", "sse"],
  danger: ["reset", "delete", "danger", "database", "wipe"],
};

export interface SettingsCategoryRailProps {
  filteredCategories: Category[];
  activeCategory: CategoryId;
  settingsSearch: string;
  onSwitchCategory: (categoryId: CategoryId) => void;
}

export const SettingsCategoryRail: FunctionComponent<SettingsCategoryRailProps> = ({
  filteredCategories,
  activeCategory,
  settingsSearch,
  onSwitchCategory,
}) => {
  const normalizedSearch = settingsSearch.trim().toLowerCase();
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (e: KeyboardEvent, index: number) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = (index + 1) % filteredCategories.length;
      buttonsRef.current[nextIndex]?.focus();
      onSwitchCategory(filteredCategories[nextIndex].id);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = (index - 1 + filteredCategories.length) % filteredCategories.length;
      buttonsRef.current[prevIndex]?.focus();
      onSwitchCategory(filteredCategories[prevIndex].id);
    }
  };

  return (
    <nav
      aria-label="Settings categories"
      className="flex min-w-0 flex-col gap-3 rounded-[1.5rem] border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] p-3 shadow-[var(--elevation-base)] backdrop-blur-2xl lg:sticky lg:top-16"
    >
      <div className="rounded-[1.1rem] border border-[color:var(--border-hairline)] bg-[var(--fill-muted)] px-4 py-3">
        <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">
          <Layers3 className="h-3.5 w-3.5" strokeWidth={2} />
          Categories
        </div>
        <div className="mt-2 min-w-0 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {normalizedSearch
            ? `Showing ${filteredCategories.length} categories for "${settingsSearch.trim()}".`
            : "Jump directly into the area you need without digging through the full settings tree."}
        </div>
      </div>

      {filteredCategories.map((category, index) => {
        const isActive = activeCategory === category.id;
        const isDanger = category.danger;
        const isSearchMatch = Boolean(normalizedSearch && (CATEGORY_SEARCH_HINTS[category.id]?.some(hint => hint.includes(normalizedSearch)) || category.label.toLowerCase().includes(normalizedSearch) || category.description.toLowerCase().includes(normalizedSearch)));

        return (
          <button
            key={category.id}
            type="button"
            ref={el => { buttonsRef.current[index] = el; }}
            onClick={() => onSwitchCategory(category.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            aria-current={isActive ? "page" : undefined}
            className={`group relative flex w-full min-w-0 items-center gap-3 rounded-[1.05rem] border px-3.5 py-3 text-left ${SHARED_INTERACTION_CLASSES} ${isDanger ? "focus-visible:ring-status-red" : ""} ${
              isActive
                ? isDanger
                  ? "border-status-red/22 bg-status-red/[0.07] dark:border-status-red/25 dark:bg-status-red/[0.08]"
                  : "border-signal-500/20 bg-signal-500/10 dark:border-signal-400/20 dark:bg-signal-400/[0.1]"
                : "border-transparent hover:border-[color:var(--border-hairline)] hover:bg-[var(--fill-muted-hover)]"
            } ${
              isSearchMatch && !isActive ? (isDanger ? "border-status-red/20 bg-status-red/[0.035] dark:border-status-red/25 dark:bg-status-red/[0.045]" : "border-signal-500/18 bg-signal-500/[0.045] dark:border-signal-400/20 dark:bg-signal-400/[0.055]") : ""
            }`}
          >
            {isActive ? (
              <div className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full ${isDanger ? "bg-status-red" : "bg-signal-500 dark:bg-signal-400"}`} />
            ) : null}

            <span className={`w-5 shrink-0 text-right font-mono text-[9px] font-bold transition-colors duration-200 ${isActive ? (isDanger ? "text-status-red/60" : "text-signal-600/60 dark:text-signal-400/60") : "text-slate-300 dark:text-slate-600"}`}>
              {category.num}
            </span>

            <category.icon
              className={`h-4 w-4 shrink-0 transition-colors duration-200 ${
                isActive
                  ? isDanger
                    ? "text-status-red"
                    : "text-signal-600 dark:text-signal-400"
                  : "text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300"
              }`}
              strokeWidth={1.75}
            />

            <div className="min-w-0 flex-1">
              <div className={`min-w-0 break-words text-sm font-semibold leading-snug transition-colors duration-200 ${
                isActive
                  ? isDanger
                    ? "text-status-red"
                    : "text-signal-700 dark:text-signal-300"
                  : "text-slate-700 group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-slate-100"
              }`}
              >
                {category.label}
              </div>
              <div className={`mt-0.5 line-clamp-2 min-w-0 break-words text-[10px] font-medium leading-snug transition-colors duration-200 ${isActive ? (isDanger ? "text-status-red/70" : "text-signal-700/70 dark:text-signal-300/70") : "text-slate-400 group-hover:text-slate-500 dark:text-slate-500 dark:group-hover:text-slate-400"}`}>
                {category.description}
              </div>
              {isSearchMatch && !isActive ? (
                <span className={`mt-2 inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.14em] ${
                  isDanger
                    ? "border-status-red/20 bg-status-red/[0.05] text-status-red"
                    : "border-signal-500/20 bg-signal-500/[0.06] text-signal-700 dark:text-signal-300"
                }`}
                >
                  Search match
                </span>
              ) : null}
            </div>
          </button>
        );
      })}

      {filteredCategories.length === 0 ? (
        <NoticePanel title="No matches">
          Try broader terms like `routing`, `CI`, `auth`, `agent`, or `memory`.
        </NoticePanel>
      ) : null}
    </nav>
  );
};
