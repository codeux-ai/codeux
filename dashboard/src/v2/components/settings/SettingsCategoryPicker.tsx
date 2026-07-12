import type { FunctionComponent } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { ChevronRight, Loader2, X } from "lucide-preact";
import type { Category, CategoryId } from "../../hooks/use-settings-page-state.js";
import type { SettingsSearchMatches } from "../../lib/settings-search-index.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { SHARED_INTERACTION_CLASSES } from "../ui/Button.js";
import { Drawer } from "../ui/Drawer.js";
import { SettingsCategoryRail } from "./SettingsCategoryRail.js";

export interface SettingsCategoryPickerProps {
  filteredCategories: Category[];
  activeCategory: CategoryId;
  activeCategoryConfig: Category;
  settingsSearch: string;
  settingsSearchMatches: SettingsSearchMatches;
  onSwitchCategory: (categoryId: CategoryId) => void;
  pendingCategory?: CategoryId | null;
  disabledCategoryReason?: string | null;
}

export const SettingsCategoryPicker: FunctionComponent<SettingsCategoryPickerProps> = ({
  filteredCategories,
  activeCategory,
  activeCategoryConfig,
  settingsSearch,
  settingsSearchMatches,
  onSwitchCategory,
  pendingCategory = null,
  disabledCategoryReason = null,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();
  const drawerDescriptionId = useId();
  const triggerDescriptionId = useId();
  const triggerStatusId = useId();
  const disabledReasonId = useId();
  const activeButtonRef = useRef<HTMLButtonElement>(null);
  const tokens = useInteractionTokens();
  const normalizedSearch = settingsSearch.trim();
  const pendingCategoryConfig = pendingCategory
    ? filteredCategories.find((category) => category.id === pendingCategory)
    : null;
  const categoryStatus = pendingCategoryConfig
    ? `Switching to ${pendingCategoryConfig.label}`
    : normalizedSearch
      ? `${filteredCategories.length} ${filteredCategories.length === 1 ? "match" : "matches"}`
      : "Change category";
  const triggerDescriptionIds = [
    triggerDescriptionId,
    triggerStatusId,
    disabledCategoryReason ? disabledReasonId : undefined,
  ].filter(Boolean).join(" ");

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = (event: MediaQueryListEvent): void => {
      if (event.matches) {
        setIsOpen(false);
      }
    };
    desktopQuery.addEventListener("change", closeOnDesktop);
    return () => desktopQuery.removeEventListener("change", closeOnDesktop);
  }, []);

  const switchCategory = (categoryId: CategoryId): void => {
    if (disabledCategoryReason) {
      return;
    }
    onSwitchCategory(categoryId);
    setIsOpen(false);
  };

  return (
    <div data-settings-accent={activeCategoryConfig.accent || "sky"} className="w-full lg:hidden">
      <button
        type="button"
        aria-label={`Change settings category. Current category: ${activeCategoryConfig.label}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-busy={pendingCategory ? "true" : undefined}
        aria-describedby={triggerDescriptionIds}
        data-motion-contract="controlFeedback"
        onClick={() => setIsOpen(true)}
        style={{
          transitionDuration: tokens.controlFeedback.duration,
          transitionTimingFunction: tokens.controlFeedback.ease,
        }}
        className={`${SHARED_INTERACTION_CLASSES} flex min-h-14 w-full min-w-0 items-center gap-3 rounded-2xl border border-signal-600/12 bg-white/65 px-3.5 py-3 text-left text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] hover:bg-white/85 focus-visible:ring-offset-white dark:border-signal-300/12 dark:bg-white/[0.05] dark:text-white dark:shadow-none dark:hover:bg-white/[0.085] dark:focus-visible:ring-offset-[#10282a]`}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[rgb(var(--settings-accent-rgb)/0.2)] bg-[rgb(var(--settings-accent-rgb)/0.1)] text-[var(--settings-accent-text)]">
          <activeCategoryConfig.icon className="h-4 w-4" strokeWidth={2.1} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{activeCategoryConfig.label}</span>
          <span id={triggerDescriptionId} className="mt-0.5 block truncate text-[10px] font-semibold text-slate-500 dark:text-slate-400">
            {activeCategoryConfig.description}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">
          {pendingCategory ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
          <span id={triggerStatusId} className="hidden min-[380px]:inline">{categoryStatus}</span>
          <ChevronRight className="h-4 w-4" strokeWidth={2.3} aria-hidden="true" />
        </span>
      </button>

      {disabledCategoryReason ? (
        <span id={disabledReasonId} className="sr-only">{disabledCategoryReason}</span>
      ) : null}

      <Drawer
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        ariaLabelledBy={titleId}
        ariaDescribedBy={drawerDescriptionId}
        initialFocusRef={activeButtonRef}
      >
        <div className="sticky top-0 z-20 border-b border-[color:var(--border-hairline)] bg-[var(--surface-glass)] px-4 py-4 backdrop-blur-2xl">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-300">
                Settings navigation
              </div>
              <h2 id={titleId} className="mt-1 font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                Choose a category
              </h2>
              <p id={drawerDescriptionId} className="mt-1 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                {normalizedSearch
                  ? `${filteredCategories.length} matching ${filteredCategories.length === 1 ? "category" : "categories"} for “${normalizedSearch}”.`
                  : `${filteredCategories.length} settings categories available.`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close settings category picker"
              className={`${SHARED_INTERACTION_CLASSES} grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[color:var(--border-hairline)] bg-[var(--fill-muted)] text-slate-500 hover:bg-[var(--fill-muted-hover)] hover:text-slate-900 dark:text-slate-300 dark:hover:text-white`}
            >
              <X className="h-4 w-4" strokeWidth={2.3} aria-hidden="true" />
            </button>
          </div>
        </div>

        <SettingsCategoryRail
          filteredCategories={filteredCategories}
          activeCategory={activeCategory}
          settingsSearch={settingsSearch}
          settingsSearchMatches={settingsSearchMatches}
          onSwitchCategory={switchCategory}
          pendingCategory={pendingCategory}
          disabledCategoryReason={disabledCategoryReason}
          variant="drawer"
          activeButtonRef={activeButtonRef}
        />
      </Drawer>
    </div>
  );
};
