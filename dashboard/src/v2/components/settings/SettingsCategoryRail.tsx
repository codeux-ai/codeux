import { Fragment, type FunctionComponent, type JSX, type RefObject } from "preact";
import { useCallback, useEffect, useId, useRef, useState } from "preact/hooks";
import type { Category, CategoryId } from "../../hooks/use-settings-page-state.js";
import {
  getSettingsSearchMatchPreview,
  type SettingsSearchMatches,
} from "../../lib/settings-search-index.js";
import { NoticePanel } from "./SettingsSurface.js";
import { SHARED_INTERACTION_CLASSES } from "../ui/Button.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import type { DashboardLocale } from "../../i18n/locales.js";
import { getDocumentDashboardLocale, getLocalizedSettingsCategoryText, getSettingsShellMessage } from "../../i18n/messages/settings-shell.js";

import { AlertTriangle, Bot, BrainCircuit, Compass, Cpu, Layers3, Monitor, Palette, Plug, Server, SlidersHorizontal, Target } from "lucide-preact";

export const CATEGORIES: Category[] = [
  { id: "general", num: "01", label: "General", icon: SlidersHorizontal, accent: "sky", description: "Scope, runtime, and automation posture" },
  { id: "appearance", num: "02", label: "Appearance", icon: Monitor, accent: "violet", description: "Dashboard layout and theme preferences" },
  { id: "models", num: "03", label: "AI Models", icon: Cpu, accent: "indigo", description: "Provider routing, models, and weighting" },
  { id: "agents", num: "04", label: "Agents", icon: Bot, accent: "cyan", description: "Agent routing, skill storage, reflection, and authoring behavior" },
  { id: "memory", num: "05", label: "Memory", icon: BrainCircuit, accent: "purple", description: "Embedding models, auto-capture, and promotion policy" },
  { id: "techstacks", num: "06", label: "Techstacks", icon: Layers3, accent: "blue", description: "Catalog stacks, application kind, and project assignment" },
  { id: "guidance", num: "07", label: "Guidance", icon: Palette, accent: "fuchsia", description: "Tech stack guidance, styleguides, and custom instructions" },
  { id: "sprint", num: "08", label: "Sprint & Git", icon: Target, accent: "orange", description: "Git flow, branch naming, merge rules, and execution runtime" },
  { id: "browser", num: "09", label: "Browser Preview", icon: Compass, accent: "teal", description: "Preview runtime, browser visibility, and container policy" },
  { id: "integrations", num: "10", label: "Integrations", icon: Plug, accent: "blue", description: "Provider keys, Git hosts, and external connection policy" },
  { id: "mcp", num: "11", label: "MCP", icon: Server, accent: "cyan", description: "MCP servers injected into CLIs and built-in tool access" },
  { id: "danger", num: "12", label: "Danger Zone", icon: AlertTriangle, accent: "red", description: "Reset project overrides only when needed", danger: true },
];

export const getLocalizedSettingsCategories = (locale: DashboardLocale): Category[] => CATEGORIES.map((category) => {
  const localized = getLocalizedSettingsCategoryText(locale, category.id);
  return localized ? { ...category, ...localized } : category;
});

const CATEGORY_GROUPS: ReadonlyArray<{ label: string; categoryIds: ReadonlyArray<CategoryId> }> = [
  { label: "Basics", categoryIds: ["general", "appearance"] },
  { label: "AI & Knowledge", categoryIds: ["models", "agents", "memory", "techstacks", "guidance"] },
  { label: "Delivery", categoryIds: ["sprint", "browser"] },
  { label: "Connections", categoryIds: ["integrations", "mcp"] },
  { label: "System", categoryIds: ["danger"] },
];

const getCategoryGroupLabel = (categoryId: CategoryId, locale: DashboardLocale): string => {
  const groupLabel = CATEGORY_GROUPS.find((group) => group.categoryIds.includes(categoryId))?.label;
  const key = groupLabel === "Basics"
    ? "groupBasics"
    : groupLabel === "AI & Knowledge"
      ? "groupAiKnowledge"
      : groupLabel === "Delivery"
        ? "groupDelivery"
        : groupLabel === "Connections"
          ? "groupConnections"
          : groupLabel === "System"
            ? "groupSystem"
            : "groupSettings";
  return getSettingsShellMessage(locale, key);
};

export interface SettingsCategoryRailProps {
  filteredCategories: Category[];
  activeCategory: CategoryId;
  settingsSearch: string;
  settingsSearchMatches: SettingsSearchMatches;
  onSwitchCategory: (categoryId: CategoryId) => void;
  pendingCategory?: CategoryId | null;
  disabledCategoryReason?: string | null;
  className?: string;
  variant?: "desktop" | "drawer";
  desktopOnly?: boolean;
  activeButtonRef?: RefObject<HTMLButtonElement>;
}

export const SettingsCategoryRail: FunctionComponent<SettingsCategoryRailProps> = ({
  filteredCategories,
  activeCategory,
  settingsSearch,
  settingsSearchMatches,
  onSwitchCategory,
  pendingCategory = null,
  disabledCategoryReason = null,
  className,
  variant = "desktop",
  desktopOnly = false,
  activeButtonRef,
}) => {
  const locale = getDocumentDashboardLocale();
  const t = (key: Parameters<typeof getSettingsShellMessage>[1], variables?: Parameters<typeof getSettingsShellMessage>[2]): string => (
    getSettingsShellMessage(locale, key, variables)
  );
  const normalizedSearch = settingsSearch.trim().toLowerCase();
  const railRef = useRef<HTMLElement | null>(null);
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const [railAvailableHeight, setRailAvailableHeight] = useState<number | null>(null);
  const [showScrollHint, setShowScrollHint] = useState(false);
  const tokens = useInteractionTokens();
  const disabledReasonId = useId();
  const instructionsId = useId();
  const instructionsText = normalizedSearch
    ? filteredCategories.length > 0
      ? t("categorySearchInstructions", { count: filteredCategories.length, searchTerm: settingsSearch.trim() })
      : t("categoryNoSearchResults", { searchTerm: settingsSearch.trim() })
    : t("categoryInstructions");
  const selectionTransitionStyle = {
    transitionDuration: tokens.selectionMovement.duration,
    transitionTimingFunction: tokens.selectionMovement.ease,
  };
  const railHeightStyle = variant === "desktop" && railAvailableHeight !== null ? {
    "--settings-category-rail-available-height": `${railAvailableHeight}px`,
  } as JSX.CSSProperties : undefined;
  const updateRailMetrics = useCallback(() => {
    if (variant === "drawer") {
      setRailAvailableHeight(null);
      setShowScrollHint(false);
      return;
    }
    const rail = railRef.current;
    if (!rail) {
      return;
    }
    const bottomGutter = 16;
    const topOffset = Math.max(0, rail.getBoundingClientRect().top);
    const availableHeight = Math.max(0, Math.floor(window.innerHeight - topOffset - bottomGutter));
    const visibleHeight = Math.min(rail.clientHeight || availableHeight, availableHeight);

    setRailAvailableHeight(availableHeight);
    setShowScrollHint(rail.scrollHeight - rail.scrollTop - visibleHeight > 2);
  }, [variant]);

  useEffect(() => {
    let frameId = 0;
    const scheduleMetricsUpdate = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateRailMetrics);
    };

    scheduleMetricsUpdate();
    window.addEventListener("resize", scheduleMetricsUpdate);
    window.addEventListener("scroll", scheduleMetricsUpdate, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", scheduleMetricsUpdate);
      window.removeEventListener("scroll", scheduleMetricsUpdate, true);
    };
  }, [filteredCategories.length, normalizedSearch, updateRailMetrics]);

  const handleKeyDown = (e: KeyboardEvent, index: number) => {
    if (filteredCategories.length === 0) {
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      const nextIndex = (index + 1) % filteredCategories.length;
      buttonsRef.current[nextIndex]?.focus();
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      const prevIndex = (index - 1 + filteredCategories.length) % filteredCategories.length;
      buttonsRef.current[prevIndex]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      buttonsRef.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      buttonsRef.current[filteredCategories.length - 1]?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSwitchCategory(filteredCategories[index].id);
    }
  };

  return (
    <nav
      ref={railRef}
      aria-label={t("settingsCategories")}
      onScroll={updateRailMetrics}
      style={railHeightStyle}
      data-motion-contract="selectionMovement"
      className={[
        variant === "drawer"
          ? "scrollbar-hide flex min-w-0 flex-col gap-3 p-3"
          : `scrollbar-hide ${desktopOnly ? "hidden lg:flex" : "flex"} min-w-0 flex-col gap-3 rounded-[1.75rem] border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] p-3 backdrop-blur-2xl shadow-[var(--elevation-base)] lg:sticky lg:top-16 lg:max-h-[var(--settings-category-rail-available-height)] lg:overflow-y-auto lg:overscroll-contain`,
        className,
      ].filter(Boolean).join(" ")}
    >
      <div
        id={instructionsId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {instructionsText}
      </div>
      {disabledCategoryReason ? (
        <div className="rounded-[1.25rem] border border-black/[0.06] bg-black/[0.03] px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
          <div
            id={disabledReasonId}
            className="rounded-xl border border-amber-500/20 bg-amber-500/[0.08] px-3 py-2 text-xs font-semibold leading-relaxed text-amber-700 dark:border-amber-300/20 dark:bg-amber-300/[0.08] dark:text-amber-200"
          >
            {disabledCategoryReason}
          </div>
        </div>
      ) : null}

      {filteredCategories.map((category, index) => {
        const isActive = activeCategory === category.id;
        const isDanger = category.danger;
        const matchPreview = getSettingsSearchMatchPreview(settingsSearchMatches[category.id], 2);
        const isSearchMatch = Boolean(normalizedSearch && matchPreview.length > 0);
        const isPending = pendingCategory === category.id;
        const disabled = Boolean(disabledCategoryReason);
        const groupLabel = getCategoryGroupLabel(category.id, locale);
        const showGroupLabel = index === 0 || getCategoryGroupLabel(filteredCategories[index - 1].id, locale) !== groupLabel;

        return (
          <Fragment key={category.id}>
          {showGroupLabel ? (
            <div className={`${index === 0 ? "mt-0" : "mt-2"} px-3 pt-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500`}>
              {groupLabel}
            </div>
          ) : null}
          <button
            key={category.id}
            data-settings-accent={category.accent || "sky"}
            type="button"
            ref={el => {
              buttonsRef.current[index] = el;
              if (isActive && activeButtonRef) {
                activeButtonRef.current = el;
              }
            }}
            disabled={disabled}
            onClick={() => onSwitchCategory(category.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            aria-current={isActive ? "page" : undefined}
            aria-disabled={disabled}
            aria-describedby={[instructionsId, disabled && disabledCategoryReason ? disabledReasonId : undefined].filter(Boolean).join(" ") || undefined}
            aria-busy={isPending ? "true" : undefined}
            data-motion-contract="selectionMovement"
            title={disabled && disabledCategoryReason ? disabledCategoryReason : undefined}
            style={selectionTransitionStyle}
            className={`group relative flex min-h-11 w-full min-w-0 items-center gap-3 rounded-[1.1rem] px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow,color,transform] motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60 ${SHARED_INTERACTION_CLASSES} ${isDanger ? "focus-visible:ring-status-red" : ""} ${
              isActive
                ? "bg-[rgb(var(--settings-accent-rgb)/0.085)]"
                : "hover:bg-[var(--fill-muted-hover)]"
            } ${
              isSearchMatch && !isActive ? (isDanger ? "ring-1 ring-status-red/30 bg-status-red/[0.03] dark:ring-status-red/40 dark:bg-status-red/[0.04]" : "ring-1 ring-signal-500/30 bg-signal-500/[0.03] dark:ring-signal-500/40 dark:bg-signal-500/[0.04]") : ""
            }`}
          >
            {isActive ? (
              <div className="absolute bottom-2.5 left-0 top-2.5 w-[3px] rounded-r-full bg-[rgb(var(--settings-accent-rgb)/0.88)]" />
            ) : null}

            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[0.7rem] border border-[rgb(var(--settings-accent-rgb)/0.14)] bg-[rgb(var(--settings-accent-rgb)/0.06)] text-[var(--settings-accent-text)] transition-[background-color,opacity] ${isActive ? "opacity-100" : "opacity-75 group-hover:bg-[rgb(var(--settings-accent-rgb)/0.1)] group-hover:opacity-100"}`}>
              <category.icon className="h-3.5 w-3.5" strokeWidth={1.9} style={selectionTransitionStyle} aria-hidden="true" />
            </span>

            <div className="min-w-0 flex-1">
              <div
                className={`text-sm font-semibold transition-colors ${
                isActive
                  ? "text-[var(--settings-accent-text)]"
                  : "text-slate-700 group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-slate-100"
              }`}
                style={selectionTransitionStyle}
              >
              {category.label}
                {isActive ? <span className="sr-only">{t("selected")}</span> : null}
                {isPending ? <span className="sr-only">{t("pending")}</span> : null}
              </div>
              {variant === "drawer" ? <div
                className={`mt-0.5 break-words text-[10px] font-medium leading-tight transition-colors ${isActive ? (isDanger ? "text-status-red/70" : "text-signal-700/70 dark:text-signal-300/70") : "text-slate-400 group-hover:text-slate-500 dark:text-slate-500 dark:group-hover:text-slate-400"}`}
                style={selectionTransitionStyle}
              >
                {category.description}
              </div> : null}
              {isSearchMatch ? (
                <div className={`mt-2 flex flex-wrap gap-1.5 text-[9px] font-bold uppercase tracking-[0.12em] ${isActive ? (isDanger ? "text-status-red/80" : "text-signal-700/80 dark:text-signal-200/80") : "text-slate-500 dark:text-slate-400"}`}>
                  {matchPreview.map((match) => (
                    <span
                      key={`${category.id}-${match}`}
                      className={`max-w-full truncate rounded-full border px-2 py-0.5 ${isDanger ? "border-status-red/20 bg-status-red/[0.05]" : "border-signal-500/20 bg-signal-500/[0.06]"}`}
                    >
                      {match}
                    </span>
                  ))}
                </div>
              ) : null}
              {disabled && disabledCategoryReason ? (
                // Accessibility contract: the localized badge remains a visible "Disabled" state.
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded-full border border-black/[0.06] bg-black/[0.03] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-400">
                    {t("disabled")}
                  </span>
                </div>
              ) : null}
            </div>
          </button>
          </Fragment>
        );
      })}

      {filteredCategories.length === 0 ? (
        <NoticePanel title={t("noMatches")} tone="warning">
          {t("noMatchesHelp")}
        </NoticePanel>
      ) : null}

      {showScrollHint ? (
        <div
          aria-hidden="true"
          data-testid="settings-category-scroll-hint"
          className="pointer-events-none sticky -bottom-4 z-20 -mx-3 -mb-4 h-12 bg-gradient-to-t from-[#F9F8F4]/95 via-[#F9F8F4]/72 to-transparent dark:from-void-800/95 dark:via-void-800/72"
        />
      ) : null}
    </nav>
  );
};
