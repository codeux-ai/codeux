import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { Check, Compass, RefreshCw, Search, Settings, Zap } from "lucide-preact";
import { ActionButton, NoticePanel } from "./components/settings/SettingsSurface.js";
import { ActionFeedbackRegion } from "./components/ui/ActionFeedbackRegion.js";
import { useSettingsPageState } from "./hooks/use-settings-page-state.js";
import { SettingsCategoryRail, CATEGORIES, CATEGORY_SEARCH_HINTS } from "./components/settings/SettingsCategoryRail.js";
import { SettingsContentPanels } from "./components/settings/SettingsContentPanels.js";
import { useReducedMotion } from "./hooks/use-reduced-motion.js";
import { PageContainer } from "./components/layout/PageContainer.js";
import { UnsavedChangesModal } from "./components/ui/UnsavedChangesModal.js";

export const SettingsPage: FunctionComponent = () => {
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  const state = useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS);
  const {
    clearFeedback,
    activeCategory,
    activeScope,
    setActiveScope,
    settingsSearch,
    setSettingsSearch,
    activeCategoryConfig,
    filteredCategories,
    error,
    selectedProject,
    activeDirty,
    activeSaving,
    loading,
    saveMessage,
    resettingProject,
    handleSave,
    handleResetProject,
    showUnsavedModal,
    confirmDiscard,
    cancelDiscard,
    saveAndLeave,
  } = state;

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      if (!headerRef.current) {
        return;
      }
      if (prefersReducedMotion) {
        gsap.set(Array.from(headerRef.current.children), { opacity: 1, y: 0 });
      } else {
        gsap.fromTo(
          Array.from(headerRef.current.children),
          { opacity: 0, y: 40 },
          { opacity: 1, y: 0, stagger: 0.09, duration: 0.9, ease: "power4.out", delay: 0.05 },
        );
      }
    });
    return () => ctx.revert();
  }, [prefersReducedMotion]);

    const switchCategory = useCallback((categoryId: typeof activeCategory): void => {
    if (!contentRef.current || categoryId === activeCategory) {
      return;
    }
    if (prefersReducedMotion) {
      state.setActiveCategory(categoryId);
      gsap.set(contentRef.current, { opacity: 1, y: 0 });
    } else {
      gsap.to(contentRef.current, {
        opacity: 0,
        y: 12,
        duration: 0.18,
        ease: "power2.in",
        onComplete: () => {
          state.setActiveCategory(categoryId);
          if (!contentRef.current) {
            return;
          }
          gsap.fromTo(
            contentRef.current,
            { opacity: 0, y: 12 },
            { opacity: 1, y: 0, duration: 0.35, ease: "power3.out" },
          );
        },
      });
    }
  }, [activeCategory, state, prefersReducedMotion]);

  return (
    <PageContainer padding="settings" className="gap-10">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_-5%_-10%,rgba(0,224,160,0.04)_0%,transparent_60%)] dark:bg-[radial-gradient(ellipse_60%_50%_at_-5%_-10%,rgba(0,224,160,0.06)_0%,transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_110%_110%,rgba(255,184,0,0.025)_0%,transparent_60%)] dark:bg-[radial-gradient(ellipse_50%_40%_at_110%_110%,rgba(255,184,0,0.04)_0%,transparent_60%)]" />
      </div>

      <div ref={headerRef} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-end">
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 font-mono">
            <Settings className="h-3.5 w-3.5" strokeWidth={2.5} />
            Configuration
          </div>

          <div className="relative overflow-hidden">
            <h2
              aria-hidden
              className="pointer-events-none absolute -left-3 -top-10 select-none font-display text-[7rem] font-black leading-none tracking-tighter text-black/[0.04] dark:text-white/[0.03]"
            >
              CONF
            </h2>
            <h1 className="relative z-10 font-display text-5xl font-black leading-[0.92] tracking-tighter text-slate-900 dark:text-white md:text-7xl">
              Settings
              <br />
              <span className="text-slate-400 dark:text-slate-500">Integration.</span>
            </h1>
          </div>

          <p className="mt-1 max-w-2xl text-lg font-medium leading-relaxed text-slate-500 dark:text-slate-500">
            Tune the system baseline, then shape project-level behavior with faster wayfinding, denser controls, and focused routing workspaces.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl border border-black/[0.06] bg-white/70 p-1 backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60">
              <button
                type="button"
                onClick={() => setActiveScope("system")}
                className={`rounded-[1rem] px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] transition-colors ${
                  activeScope === "system"
                    ? "bg-signal-500/[0.12] text-signal-700 dark:text-signal-300"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                System
              </button>
              <button
                type="button"
                onClick={() => selectedProject && setActiveScope("project")}
                disabled={!selectedProject}
                className={`rounded-[1rem] px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  activeScope === "project"
                    ? "bg-signal-500/[0.12] text-signal-700 dark:text-signal-300"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                Project
              </button>
            </div>

            <div className="rounded-full border border-black/[0.06] bg-white/70 px-4 py-2 text-xs font-semibold text-slate-500 backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:text-slate-300">
              {activeScope === "system"
                ? "Editing live system defaults"
                : selectedProject
                  ? `Editing overrides for ${selectedProject.name}`
                  : "Select a project to edit overrides"}
            </div>

            <div className="rounded-full border border-black/[0.06] bg-white/70 px-4 py-2 text-xs font-semibold text-slate-500 backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:text-slate-300">
              {filteredCategories.length} visible categor{filteredCategories.length === 1 ? "y" : "ies"}
            </div>

            {activeDirty ? (
              <div className="rounded-full border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-700 backdrop-blur-2xl dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-200">
                Unsaved edits
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-black/[0.06] bg-white/70 p-4 backdrop-blur-2xl shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
            <Compass className="h-3.5 w-3.5" strokeWidth={2.2} />
            Smart Find
          </div>
          <div className="mt-3 flex items-center gap-3 rounded-[1rem] border border-black/[0.06] bg-black/[0.03] px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
            <Search className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={2.1} />
            <input
              ref={state.searchInputRef}
              type="text"
              value={settingsSearch}
              onInput={(event) => setSettingsSearch((event.currentTarget as HTMLInputElement).value)}
              placeholder="Search categories, providers, CI, auth, prompts"
              className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
            />
            <div className="rounded-full border border-black/[0.06] bg-white/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.04]">
              /
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {filteredCategories
              .filter((c) => !["general", "models", "sprint", "browser"].includes(c.id))
              .slice(0, 4)
              .map((category) => (
              <button
                key={`quick-${category.id}`}
                type="button"
                onClick={() => switchCategory(category.id)}
                className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                  activeCategory === category.id
                    ? "border-signal-500/25 bg-signal-500/[0.12] text-signal-700 dark:border-signal-400/25 dark:bg-signal-400/[0.12] dark:text-signal-200"
                    : "border-black/[0.06] bg-white/80 text-slate-500 hover:text-slate-800 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {category.label}
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {activeScope === "project" ? (
              <ActionButton
                label="Reset Project"
                onClick={() => void handleResetProject()}
                tone="danger"
                busy={resettingProject}
                disabled={!selectedProject}
              />
            ) : null}
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!activeDirty || activeSaving || loading || (activeScope === "project" && !selectedProject)}
              className={`group inline-flex items-center gap-2.5 rounded-2xl px-5 py-3 text-sm font-bold transition-[background-color,box-shadow,transform] duration-300 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 ${
                saveMessage && !error
                  ? "bg-status-green text-white shadow-[0_4px_20px_rgba(0,171,132,0.3)]"
                  : "bg-slate-900 text-white shadow-[0_4px_12px_rgba(0,0,0,0.15)] hover:bg-slate-700 dark:bg-white dark:text-void-900 dark:hover:bg-slate-100"
              }`}
            >
              {activeSaving ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2.5} />
                  Saving
                </>
              ) : saveMessage && !error ? (
                <>
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                  Saved
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 transition-transform duration-200 group-hover:scale-110" strokeWidth={2} />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[300px_1fr]">
        <SettingsCategoryRail
          activeCategory={activeCategory}
          filteredCategories={filteredCategories}
          settingsSearch={settingsSearch}
          onSwitchCategory={switchCategory}
        />

        <div ref={contentRef} className="flex min-w-0 flex-col gap-5">
          <div className="mb-1 flex flex-wrap items-center gap-3">
            <activeCategoryConfig.icon
              className={`h-4 w-4 ${activeCategoryConfig.danger ? "text-status-red" : "text-signal-500"}`}
              strokeWidth={2}
            />
            <span className={`font-mono text-[10px] font-bold uppercase tracking-[0.2em] ${
              activeCategoryConfig.danger ? "text-status-red/70" : "text-signal-500"
            }`}
            >
              {activeCategoryConfig.label}
            </span>
            <span className="rounded-full border border-black/[0.06] bg-black/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
              {activeCategoryConfig.description}
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-black/[0.06] to-transparent dark:from-white/[0.06]" />
          </div>

          <div className="flex flex-col gap-3">
            <ActionFeedbackRegion
              status={error ? "error" : saveMessage ? "success" : "idle"}
              message={error || saveMessage || null}
              onDismiss={clearFeedback}
            />
          </div>

          <SettingsContentPanels state={state} />
        </div>
      </div>

      {showUnsavedModal && (
        <UnsavedChangesModal
          onConfirm={confirmDiscard}
          onCancel={cancelDiscard}
          onSave={() => void saveAndLeave()}
          saving={activeSaving}
        />
      )}
    </PageContainer>
  );
};
