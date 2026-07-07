import type { FunctionComponent, JSX, RefObject } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Check, Compass, RefreshCw, Search, Settings, X, Zap } from "lucide-preact";
import { ActionButton } from "./components/settings/SettingsSurface.js";
import { ActionFeedbackRegion } from "./components/ui/ActionFeedbackRegion.js";
import { useSettingsPageState, type Category, type CategoryId } from "./hooks/use-settings-page-state.js";
import { SettingsCategoryRail, CATEGORIES } from "./components/settings/SettingsCategoryRail.js";
import { SettingsContentPanels } from "./components/settings/SettingsContentPanels.js";
import { SettingsActivePanelStatus } from "./components/settings/SettingsActivePanelStatus.js";
import { SettingsScopeControls } from "./components/settings/SettingsScopeControls.js";
import { useReducedMotion } from "./hooks/use-reduced-motion.js";
import { useGsapInteractionTokens } from "./lib/motion/constants.js";
import { useInteractionTokens } from "./lib/motion/tokens.js";
import { PageContainer } from "./components/layout/PageContainer.js";
import { PageHeader } from "./components/layout/PageHeader.js";
import { ConfirmDialog } from "./components/ui/ConfirmDialog.js";
import { UnsavedChangesModal } from "./components/ui/UnsavedChangesModal.js";
import { useConfirmDialog } from "./hooks/use-confirm-dialog.js";
import { getSettingsSearchMatchPreview, type SettingsSearchMatches } from "./lib/settings-search-index.js";

interface SettingsSearchStatusDetails {
  searchTerm: string;
  resultCount: number;
  matchingCategoryCount: number;
  activeCategoryLabel: string;
  activeMatchPreview: string[];
  smartFindPreview: string[];
}

export function getSettingsSearchStatusText({
  searchTerm,
  resultCount,
  matchingCategoryCount,
  activeCategoryLabel,
  activeMatchPreview,
  smartFindPreview,
}: SettingsSearchStatusDetails): string {
  const categoryLabel = matchingCategoryCount === 1 ? "matching category" : "matching categories";
  const resultLabel = resultCount === 1 ? "result" : "results";
  const activePreviewText = activeMatchPreview.length
    ? ` Active matches: ${activeMatchPreview.join(", ")}.`
    : "";
  const previewText = smartFindPreview.length
    ? ` Match previews: ${smartFindPreview.join(", ")}.`
    : " Match previews: none.";
  const recoveryText = matchingCategoryCount === 0
    ? " Clear the search or try routing, provider, auth, CI, agent, or memory."
    : "";

  return `${resultCount} ${resultLabel} across ${matchingCategoryCount} ${categoryLabel} for "${searchTerm}". Active category: ${activeCategoryLabel}.${activePreviewText}${previewText}${recoveryText}`;
}

export interface SettingsSmartFindSearchProps {
  settingsSearch: string;
  setSettingsSearch: (value: string) => void;
  searchInputRef: RefObject<HTMLInputElement>;
  filteredCategories: Category[];
  settingsSearchMatches: SettingsSearchMatches;
  activeCategory: CategoryId;
  activeCategoryConfig: Category;
  onSwitchCategory: (categoryId: CategoryId) => void;
  interactionStyle: JSX.CSSProperties;
}

export const SettingsSmartFindSearch: FunctionComponent<SettingsSmartFindSearchProps> = ({
  settingsSearch,
  setSettingsSearch,
  searchInputRef,
  filteredCategories,
  settingsSearchMatches,
  activeCategory,
  activeCategoryConfig,
  onSwitchCategory,
  interactionStyle,
}) => {
  const normalizedSearch = settingsSearch.trim();
  const isSearchActive = normalizedSearch.length > 0;
  const smartFindPreview = useMemo(() => (
    filteredCategories
      .flatMap((category) => getSettingsSearchMatchPreview(settingsSearchMatches[category.id], 2))
      .filter((match, index, matches) => matches.indexOf(match) === index)
      .slice(0, 4)
  ), [filteredCategories, settingsSearchMatches]);
  const activeMatchPreview = getSettingsSearchMatchPreview(settingsSearchMatches[activeCategory], 3);
  const smartFindMatchCount = useMemo(() => (
    Object.values(settingsSearchMatches).reduce((count, match) => (
      count + match.matchedLabels.length + match.matchedDescriptions.length + match.matchedTerms.length
    ), 0)
  ), [settingsSearchMatches]);
  const quickCategories = useMemo(() => (
    (isSearchActive ? filteredCategories : CATEGORIES)
      .filter((category) => !["general", "models", "sprint", "browser"].includes(category.id))
      .slice(0, 4)
  ), [filteredCategories, isSearchActive]);
  const activeSearchStatus = isSearchActive
    ? getSettingsSearchStatusText({
      searchTerm: normalizedSearch,
      resultCount: smartFindMatchCount,
      matchingCategoryCount: filteredCategories.length,
      activeCategoryLabel: activeCategoryConfig.label,
      activeMatchPreview,
      smartFindPreview,
    })
    : null;

  return (
    <>
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
        <Compass className="h-3.5 w-3.5" strokeWidth={2.2} />
        Smart Find
      </div>
      <label htmlFor="settings-search" className="sr-only">
        Search settings categories
      </label>
      <div className="mt-3 flex items-center gap-3 rounded-[1rem] border border-black/[0.06] bg-black/[0.03] px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
        <Search className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={2.1} />
        <input
          id="settings-search"
          ref={searchInputRef}
          type="text"
          value={settingsSearch}
          onInput={(event) => setSettingsSearch((event.currentTarget as HTMLInputElement).value)}
          placeholder="Search categories, providers, CI, auth, prompts"
          aria-describedby="settings-search-results"
          className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
        />
        {isSearchActive ? (
          <button
            type="button"
            onClick={() => {
              setSettingsSearch("");
              searchInputRef.current?.focus({ preventScroll: true });
            }}
            aria-label="Clear settings search"
            style={interactionStyle}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-black/[0.06] bg-white/80 text-slate-400 transition-colors hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-signal)] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:text-slate-100 dark:focus-visible:ring-offset-void-900"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.4} />
          </button>
        ) : (
          <div className="rounded-full border border-black/[0.06] bg-white/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.04]">
            /
          </div>
        )}
      </div>
      <div
        id="settings-search-results"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400"
      >
        {isSearchActive ? (
          activeSearchStatus
        ) : (
          <>
            <span className="sr-only">
              {filteredCategories.length} settings categories available.
            </span>
            <span>Press slash to search settings.</span>
          </>
        )}
      </div>
      {isSearchActive && smartFindPreview.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Smart Find match previews">
          {smartFindPreview.map((match) => (
            <span key={match} className="max-w-full truncate rounded-full border border-signal-500/20 bg-signal-500/[0.06] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-signal-700 dark:text-signal-200">
              {match}
            </span>
          ))}
        </div>
      ) : null}
      {quickCategories.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {quickCategories.map((category) => (
            <button
              key={`quick-${category.id}`}
              type="button"
              onClick={() => onSwitchCategory(category.id)}
              aria-pressed={activeCategory === category.id}
              aria-controls="settings-active-category-panel"
              style={interactionStyle}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-signal)] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 ${
                activeCategory === category.id
                  ? "border-signal-500/25 bg-signal-500/[0.12] text-signal-700 dark:border-signal-400/25 dark:bg-signal-400/[0.12] dark:text-signal-200"
                  : "border-black/[0.06] bg-white/80 text-slate-500 hover:text-slate-800 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {category.label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
};

export function focusFirstInvalidSettingsControl(root: ParentNode): string | null {
  const controls = Array.from(root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    "input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
  ) ?? []);
  const hasInvalidNativeValue = (control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): boolean => {
    if (control.tagName === "INPUT" && (control as HTMLInputElement).type === "number") {
      const numericValue = Number(control.value);
      const minValue = (control as HTMLInputElement).min;
      const maxValue = (control as HTMLInputElement).max;
      const min = minValue === "" ? null : Number(minValue);
      const max = maxValue === "" ? null : Number(maxValue);
      if (!Number.isFinite(numericValue)) {
        return true;
      }
      if (min !== null && numericValue < min) {
        return true;
      }
      if (max !== null && numericValue > max) {
        return true;
      }
    }
    return typeof control.checkValidity === "function" && !control.checkValidity();
  };
  const invalidControl = controls.find((control) => (
    control.getAttribute("aria-invalid") === "true"
    || hasInvalidNativeValue(control)
  ));
  if (!invalidControl) {
    return null;
  }

  const errorMessageId = invalidControl.getAttribute("aria-errormessage");
  const rootLookup = root as ParentNode & { getElementById?: (id: string) => HTMLElement | null };
  const describedError = errorMessageId
    ? errorMessageId
      .split(/\s+/)
      .map((id) => rootLookup.getElementById?.(id) ?? document.getElementById(id))
      .find((element) => element?.textContent?.trim())
      ?.textContent
      ?.trim()
    : null;
  const message = describedError || ("validationMessage" in invalidControl && invalidControl.validationMessage
    ? invalidControl.validationMessage
    : "Fix the highlighted setting before saving changes.");
  invalidControl.setAttribute("aria-invalid", "true");
  if (typeof invalidControl.scrollIntoView === "function") {
    invalidControl.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
  }
  if ("reportValidity" in invalidControl && typeof invalidControl.reportValidity === "function") {
    invalidControl.reportValidity();
  }
  invalidControl.focus({ preventScroll: true });
  window.setTimeout(() => {
    invalidControl.focus({ preventScroll: true });
  }, 0);
  return message;
}

export const SettingsPage: FunctionComponent = () => {
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const contentTweenRef = useRef<ReturnType<typeof gsap.to> | null>(null);
  const mountedRef = useRef(true);
  const prefersReducedMotion = useReducedMotion();
  const gsapTokens = useGsapInteractionTokens();
  const interactionTokens = useInteractionTokens();
  const [pendingCategory, setPendingCategory] = useState<typeof CATEGORIES[number]["id"] | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const resetProjectConfirm = useConfirmDialog();
  const saveDisabledReasonId = "settings-save-disabled-reason";

  const state = useSettingsPageState(CATEGORIES);
  const {
    clearFeedback,
    activeCategory,
    activeScope,
    setActiveScope,
    settingsSearch,
    setSettingsSearch,
    activeCategoryConfig,
    filteredCategories,
    settingsSearchMatches,
    error,
    selectedProject,
    activeDirty,
    activeSaving,
    loading,
    saveMessage,
    handleSave,
    handleResetProject,
    resettingProject,
    showUnsavedModal,
    confirmDiscard,
    cancelDiscard,
    saveAndLeave,
  } = state;

  const normalizedSearch = settingsSearch.trim();
  const scopeControlStyle = {
    transitionDuration: interactionTokens.controlFeedback.duration,
    transitionTimingFunction: interactionTokens.controlFeedback.ease,
  };
  const projectSourceSummary = useMemo(() => {
    if (activeScope !== "project" || !selectedProject) {
      return null;
    }
    const sources = Object.values(state.projectSources ?? {});
    const overridden = sources.filter((source) => source === "project").length;
    const inherited = sources.filter((source) => source === "system").length;
    if (overridden === 0 && inherited === 0) {
      return "Project settings are inheriting system defaults until an override is edited.";
    }
    return `${overridden} overridden ${overridden === 1 ? "setting" : "settings"} and ${inherited} inherited ${inherited === 1 ? "setting" : "settings"} in this project scope.`;
  }, [activeScope, selectedProject, state.projectSources]);
  const scopeStatusText = activeScope === "system"
    ? "System scope selected. Editing live system defaults."
    : selectedProject
      ? `Project scope selected. Editing overrides for ${selectedProject.name}. ${projectSourceSummary ?? "Inherited and overridden badges identify each setting source."}`
      : "Project scope is unavailable until a project is selected.";
  const saveDisabledReason = activeSaving
    ? "Settings are saving."
    : loading
      ? "Settings are still loading."
      : activeScope === "project" && !selectedProject
        ? "Select a project before saving project settings."
        : !activeDirty
          ? "No settings changes to save."
          : undefined;

  useEffect(() => () => {
    mountedRef.current = false;
    if (contentTweenRef.current && typeof contentTweenRef.current.kill === "function") {
      contentTweenRef.current.kill();
    }
  }, []);

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
      if (typeof gsap.killTweensOf === "function") {
        gsap.killTweensOf(contentRef.current);
      }
      if (contentTweenRef.current && typeof contentTweenRef.current.kill === "function") {
        contentTweenRef.current.kill();
      }
      state.setActiveCategory(categoryId);
      gsap.set(contentRef.current, { opacity: 1, y: 0 });
      setPendingCategory(null);
    } else {
      setPendingCategory(categoryId);
      if (contentTweenRef.current && typeof contentTweenRef.current.kill === "function") {
        contentTweenRef.current.kill();
      }
      contentTweenRef.current = gsap.to(contentRef.current, {
        opacity: 0,
        y: 12,
        duration: gsapTokens.selectionMovement.duration,
        ease: gsapTokens.selectionMovement.ease,
        overwrite: "auto",
        onComplete: () => {
          if (!mountedRef.current) {
            return;
          }
          state.setActiveCategory(categoryId);
          if (!contentRef.current) {
            setPendingCategory(null);
            return;
          }
          contentTweenRef.current = gsap.fromTo(
            contentRef.current,
            { opacity: 0, y: 12 },
            {
              opacity: 1,
              y: 0,
              duration: gsapTokens.enterExit.duration,
              ease: gsapTokens.enterExit.ease,
              overwrite: "auto",
              onComplete: () => {
                if (mountedRef.current) {
                  setPendingCategory(null);
                }
              },
            },
          );
        },
      });
    }
  }, [activeCategory, state, prefersReducedMotion, gsapTokens.selectionMovement.duration, gsapTokens.selectionMovement.ease, gsapTokens.enterExit.duration, gsapTokens.enterExit.ease]);

  const focusFirstInvalidSetting = useCallback((): boolean => {
    const message = focusFirstInvalidSettingsControl(contentRef.current ?? document);
    if (!message) {
      setValidationMessage(null);
      return false;
    }
    setValidationMessage(message);
    return true;
  }, []);

  const handleSaveRequest = useCallback(async (): Promise<void> => {
    if (activeSaving || loading) {
      return;
    }
    if (focusFirstInvalidSetting()) {
      return;
    }
    await handleSave();
  }, [activeSaving, focusFirstInvalidSetting, handleSave, loading]);

  const handleResetProjectRequest = useCallback(async (): Promise<void> => {
    if (!selectedProject || resettingProject) {
      return;
    }
    const confirmed = await resetProjectConfirm.requestConfirm({
      title: "Reset Project Overrides",
      body: `Clear saved settings overrides for "${selectedProject.name}" and inherit system defaults again? Project tasks, sprints, memories, and history will be kept.`,
      confirmLabel: "Reset Project",
      destructive: true,
    });
    if (confirmed) {
      await handleResetProject();
    }
  }, [handleResetProject, resetProjectConfirm, resettingProject, selectedProject]);

  return (
    <PageContainer aria-label="Settings" padding="settings" className="gap-10">
      <ConfirmDialog
        isOpen={resetProjectConfirm.isOpen}
        options={resetProjectConfirm.options}
        onConfirm={resetProjectConfirm.handleConfirm}
        onCancel={resetProjectConfirm.handleCancel}
      />
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_-5%_-10%,rgba(0,224,160,0.04)_0%,transparent_60%)] dark:bg-[radial-gradient(ellipse_60%_50%_at_-5%_-10%,rgba(0,224,160,0.06)_0%,transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_110%_110%,rgba(255,184,0,0.025)_0%,transparent_60%)] dark:bg-[radial-gradient(ellipse_50%_40%_at_110%_110%,rgba(255,184,0,0.04)_0%,transparent_60%)]" />
      </div>

      <div ref={headerRef} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] xl:items-end">
        <div className="flex flex-col gap-5">
          <PageHeader
            icon={Settings}
            eyebrow="Configuration"
            title="Settings & Integration"
            subtitle="Tune the system baseline, then shape project-level behavior with faster wayfinding, denser controls, and focused routing workspaces."
          />
        </div>

        <div className="rounded-[1.75rem] border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] p-4 backdrop-blur-2xl shadow-[var(--elevation-base)]">
          <SettingsSmartFindSearch
            settingsSearch={settingsSearch}
            setSettingsSearch={setSettingsSearch}
            searchInputRef={state.searchInputRef}
            filteredCategories={filteredCategories}
            settingsSearchMatches={settingsSearchMatches}
            activeCategory={activeCategory}
            activeCategoryConfig={activeCategoryConfig}
            onSwitchCategory={switchCategory}
            interactionStyle={scopeControlStyle}
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {activeScope === "project" ? (
              <ActionButton
                label={resettingProject ? "Resetting Project" : "Reset Project"}
                onClick={() => void handleResetProjectRequest()}
                tone="danger"
                busy={resettingProject}
                disabled={!selectedProject || resettingProject}
                disabledReason={!selectedProject ? "Select a project before resetting overrides." : resettingProject ? "Project overrides are resetting." : undefined}
              />
            ) : null}
            <button
              type="button"
              onClick={() => void handleSaveRequest()}
              disabled={!activeDirty || activeSaving || loading || (activeScope === "project" && !selectedProject)}
              aria-busy={activeSaving ? "true" : undefined}
              aria-disabled={!activeDirty || activeSaving || loading || (activeScope === "project" && !selectedProject)}
              aria-describedby={saveDisabledReason ? saveDisabledReasonId : undefined}
              title={saveDisabledReason}
              data-motion-contract="controlFeedback"
              className={`group inline-flex items-center gap-2.5 rounded-2xl px-5 py-3 text-sm font-bold transition-[background-color,box-shadow,transform] duration-300 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 ${
                saveMessage && !error
                  ? "bg-status-green text-white shadow-[var(--elevation-raised)]"
                  : "bg-slate-900 text-white shadow-[var(--elevation-raised)] hover:bg-slate-700 dark:bg-white dark:text-void-900 dark:hover:bg-slate-100"
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
                  Save Changes
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 transition-transform duration-200 group-hover:scale-110" strokeWidth={2} />
                  Save Changes
                </>
              )}
            </button>
            {saveDisabledReason ? (
              <div id={saveDisabledReasonId} className="w-full text-xs font-semibold leading-relaxed text-slate-500 dark:text-slate-400">
                {saveDisabledReason}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-x-8 gap-y-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div
          data-settings-sticky="settings-command-status"
          className="sticky top-16 z-30 -mx-1 flex min-w-0 max-w-full flex-wrap items-center gap-3 overflow-visible px-1 py-2 lg:col-start-2 lg:row-start-1"
        >
          <SettingsScopeControls
            activeScope={activeScope}
            setActiveScope={setActiveScope}
            selectedProject={selectedProject}
            scopeStatusText={scopeStatusText}
            projectSourceSummary={projectSourceSummary}
            filteredCategoryCount={filteredCategories.length}
            isSearchActive={normalizedSearch.length > 0}
            activeDirty={activeDirty}
            activeSaving={activeSaving}
            saveMessage={saveMessage}
            error={error}
            interactionStyle={scopeControlStyle}
          />
          <SettingsActivePanelStatus
            state={state}
            sticky={false}
            className="mb-0"
          />
        </div>

        <SettingsCategoryRail
          activeCategory={activeCategory}
          filteredCategories={filteredCategories}
          settingsSearch={settingsSearch}
          settingsSearchMatches={settingsSearchMatches}
          onSwitchCategory={switchCategory}
          pendingCategory={pendingCategory}
          className="lg:col-start-1 lg:row-span-2 lg:row-start-1"
        />

        <div
          id="settings-active-category-panel"
          ref={contentRef}
          role="region"
          aria-label="Settings category panel"
          aria-busy={activeSaving || loading || resettingProject ? "true" : undefined}
          data-motion-contract="enterExit"
          className="flex min-w-0 flex-col gap-5 lg:col-start-2 lg:row-start-2"
        >
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
            <span className="max-w-full break-words rounded-full border border-black/[0.06] bg-black/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
              {activeCategoryConfig.description}
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-black/[0.06] to-transparent dark:from-white/[0.06]" />
          </div>

          <div className="flex flex-col gap-3">
            {loading ? (
              <div role="status" aria-label="Loading settings" aria-live="polite" aria-busy="true" className="sr-only">
                Loading settings.
              </div>
            ) : null}
            <ActionFeedbackRegion
              status={error ? "error" : validationMessage ? "warning" : activeSaving || resettingProject ? "pending" : saveMessage ? "success" : activeDirty ? "warning" : "idle"}
              message={error || validationMessage || (resettingProject ? "Resetting project overrides..." : activeSaving ? "Saving changes..." : saveMessage ? "Changes saved." : activeDirty ? "You have unsaved changes." : null)}
              onDismiss={() => {
                setValidationMessage(null);
                clearFeedback();
              }}
            />
          </div>

          <SettingsContentPanels state={state} showActivePanelStatus={false} />
        </div>
      </div>

      {showUnsavedModal && (
        <UnsavedChangesModal
          onConfirm={confirmDiscard}
          onCancel={cancelDiscard}
          onSave={() => void saveAndLeave()}
          saving={activeSaving}
          discarding={false}
        />
      )}
    </PageContainer>
  );
};
