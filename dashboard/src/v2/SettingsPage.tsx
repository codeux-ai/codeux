import type { FunctionComponent, JSX, RefObject } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Check, RefreshCw, Search, Settings, X, Zap } from "lucide-preact";
import { ActionButton } from "./components/settings/SettingsSurface.js";
import { ActionFeedbackRegion } from "./components/ui/ActionFeedbackRegion.js";
import { useSettingsPageState, type Category, type CategoryId } from "./hooks/use-settings-page-state.js";
import { SettingsCategoryRail, CATEGORIES } from "./components/settings/SettingsCategoryRail.js";
import { SettingsCategoryPicker } from "./components/settings/SettingsCategoryPicker.js";
import { SettingsContentPanels } from "./components/settings/SettingsContentPanels.js";
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
      <label htmlFor="settings-search" className="sr-only">
        Search settings categories
      </label>
      <div className="flex items-center gap-3 rounded-[1rem] border border-black/[0.06] bg-black/[0.03] px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
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
        className={isSearchActive ? "mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400" : "sr-only"}
      >
        {isSearchActive ? (
          activeSearchStatus
        ) : (
          `${filteredCategories.length} settings categories available.`
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
            interactionStyle={scopeControlStyle}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-x-8 gap-y-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div
          data-settings-sticky="settings-command-status"
          style={{ background: "var(--settings-command-surface)" }}
          className="sticky top-16 z-30 -mx-2 flex min-w-0 max-w-full flex-wrap items-start gap-2.5 overflow-visible rounded-[1.75rem] border border-[color:var(--settings-command-border)] p-3 shadow-[var(--settings-command-shadow)] backdrop-blur-2xl lg:col-start-2 lg:row-start-1"
        >
          <SettingsCategoryPicker
            activeCategory={activeCategory}
            activeCategoryConfig={activeCategoryConfig}
            filteredCategories={filteredCategories}
            settingsSearch={settingsSearch}
            settingsSearchMatches={settingsSearchMatches}
            onSwitchCategory={switchCategory}
            pendingCategory={pendingCategory}
          />
          <div data-settings-accent={activeCategoryConfig.accent || "sky"} className={`hidden min-w-[15rem] flex-1 items-center gap-3 rounded-[1.25rem] border px-3.5 py-3 lg:flex ${
            activeCategoryConfig.danger
              ? "border-status-red/15 bg-status-red/[0.055]"
              : "border-[rgb(var(--settings-accent-rgb)/0.13)] bg-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:bg-white/[0.045] dark:shadow-none"
          }`}>
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[0.95rem] border ${
              activeCategoryConfig.danger
                ? "border-status-red/20 bg-status-red/10 text-status-red"
                : "border-[rgb(var(--settings-accent-rgb)/0.2)] bg-[rgb(var(--settings-accent-rgb)/0.1)] text-[var(--settings-accent-text)]"
            }`}>
              <activeCategoryConfig.icon className="h-[1.1rem] w-[1.1rem]" strokeWidth={2.1} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className={`block font-mono text-[9px] font-bold uppercase tracking-[0.18em] ${activeCategoryConfig.danger ? "text-status-red/75" : "text-[var(--settings-accent-text)]"}`}>
                {activeCategoryConfig.num} · Active category
              </span>
              <span className="mt-0.5 block text-sm font-bold text-slate-900 dark:text-white">{activeCategoryConfig.label}</span>
              <span className="mt-0.5 block truncate text-[10px] font-semibold text-slate-500 dark:text-slate-400">{activeCategoryConfig.description}</span>
            </span>
          </div>
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
          <div className="ml-auto flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2">
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
              className={`group inline-flex h-10 items-center gap-2.5 rounded-xl border px-4 text-sm font-bold transition-[background-color,border-color,box-shadow,transform] duration-300 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-signal)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-[#10282a] ${
                saveMessage && !error
                  ? "border-status-green/25 bg-status-green text-white shadow-[0_10px_28px_rgba(16,185,129,0.2)]"
                  : "border-[rgb(var(--accent-action-rgb)/0.22)] bg-[var(--accent-action)] text-[var(--accent-on-solid)] shadow-[0_10px_28px_rgb(var(--accent-action-rgb)/0.2)] hover:border-[rgb(var(--accent-action-rgb)/0.34)] hover:bg-[var(--accent-action-hover)]"
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
              <span id={saveDisabledReasonId} className="sr-only">
                {saveDisabledReason}
              </span>
            ) : null}
          </div>
        </div>

        <SettingsCategoryRail
          activeCategory={activeCategory}
          filteredCategories={filteredCategories}
          settingsSearch={settingsSearch}
          settingsSearchMatches={settingsSearchMatches}
          onSwitchCategory={switchCategory}
          pendingCategory={pendingCategory}
          desktopOnly
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

          <SettingsContentPanels state={state} showActivePanelStatus={false} showFeedback={false} detailWorkspace />
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
