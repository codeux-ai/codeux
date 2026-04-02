import type { FunctionComponent } from "preact";
import { Layers3 } from "lucide-preact";
import type { Category, CategoryId } from "../../hooks/use-settings-page-state.js";
import { NoticePanel } from "./SettingsSurface.js";

import { AlertTriangle, Bot, BrainCircuit, Compass, Cpu, Plug, Settings, SlidersHorizontal, Target } from "lucide-preact";

export const CATEGORIES: Category[] = [
  { id: "general", num: "01", label: "General", icon: SlidersHorizontal, description: "Scope, runtime, and automation posture" },
  { id: "models", num: "02", label: "AI Models", icon: Cpu, description: "Provider routing, models, and weighting" },
  { id: "sprint", num: "03", label: "Sprint Engine", icon: Target, description: "Merge rules, loop control, and execution runtime" },
  { id: "browser", num: "04", label: "Browser Preview", icon: Compass, description: "Preview runtime, browser visibility, and container policy" },
  { id: "agents", num: "05", label: "Agents", icon: Bot, description: "Project-local markdown mirrors and agent authoring behavior" },
  { id: "memory", num: "06", label: "Memory", icon: BrainCircuit, description: "Embedding models, auto-capture, and promotion policy" },
  { id: "integrations", num: "07", label: "Integrations", icon: Plug, description: "Provider keys, GitHub, and external connection policy" },
  { id: "danger", num: "08", label: "Danger Zone", icon: AlertTriangle, description: "Reset project overrides only when needed", danger: true },
];

export const CATEGORY_SEARCH_HINTS: Record<CategoryId, string[]> = {
  general: ["automation", "scope", "runtime", "dashboard", "clarification", "pause", "resume"],
  models: ["provider", "routing", "model", "thinking", "worker", "codex", "gemini", "claude", "jules"],
  sprint: ["ci", "merge", "watch", "loop", "docker", "execution", "cleanup", "branch", "autofix", "browser", "preview", "container", "port"],
  browser: ["browser", "preview", "container", "port", "routing", "rebuild", "launch", "concurrent", "iframe"],
  agents: ["agent", "prompt", "template", "markdown", "instruction"],
  memory: ["memory", "embedding", "capture", "promotion", "learning"],
  integrations: ["github", "token", "api key", "auth", "credential", "integration"],
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

  return (
    <div className="sticky top-16 flex flex-col gap-3 rounded-[1.75rem] border border-black/[0.06] bg-white/70 p-3 backdrop-blur-2xl shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
      <div className="rounded-[1.25rem] border border-black/[0.06] bg-black/[0.03] px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
        <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-600">
          <Layers3 className="h-3.5 w-3.5" strokeWidth={2} />
          Categories
        </div>
        <div className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {normalizedSearch
            ? `Showing ${filteredCategories.length} categories for “${settingsSearch.trim()}”.`
            : "Jump directly into the area you need without digging through the full settings tree."}
        </div>
      </div>

      {filteredCategories.map((category) => {
        const isActive = activeCategory === category.id;
        const isDanger = category.danger;

        return (
          <button
            key={category.id}
            type="button"
            onClick={() => onSwitchCategory(category.id)}
            className={`group relative flex w-full items-center gap-3.5 rounded-[1.1rem] px-4 py-3.5 text-left transition-colors duration-200 ${
              isActive
                ? isDanger
                  ? "bg-status-red/[0.07] dark:bg-status-red/[0.08]"
                  : "bg-signal-500/[0.08] dark:bg-signal-500/[0.1]"
                : "hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
            }`}
          >
            {isActive ? (
              <div className={`absolute left-0 top-3 bottom-3 w-[2.5px] rounded-full ${isDanger ? "bg-status-red" : "bg-signal-500"}`} />
            ) : null}

            <span className="w-5 shrink-0 text-right font-mono text-[9px] font-bold text-slate-300 dark:text-slate-600">
              {category.num}
            </span>

            <category.icon
              className={`h-4 w-4 shrink-0 transition-colors duration-200 ${
                isActive
                  ? isDanger
                    ? "text-status-red"
                    : "text-signal-500"
                  : "text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300"
              }`}
              strokeWidth={1.75}
            />

            <div className="min-w-0 flex-1">
              <div className={`text-sm font-semibold transition-colors duration-200 ${
                isActive
                  ? isDanger
                    ? "text-status-red"
                    : "text-signal-600 dark:text-signal-400"
                  : "text-slate-700 dark:text-slate-300"
              }`}
              >
                {category.label}
              </div>
              <div className="mt-0.5 truncate text-[10px] font-medium leading-tight text-slate-400 dark:text-slate-600">
                {category.description}
              </div>
            </div>
          </button>
        );
      })}

      {filteredCategories.length === 0 ? (
        <NoticePanel title="No matches">
          Try broader terms like `routing`, `CI`, `auth`, `agent`, or `memory`.
        </NoticePanel>
      ) : null}
    </div>
  );
};
