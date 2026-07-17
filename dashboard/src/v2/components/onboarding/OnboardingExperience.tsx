import type { FunctionComponent } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Check,
  ChevronRight,
  ClipboardList,
  Compass,
  Cpu,
  BookOpen,
  FolderOpen,
  GitBranch,
  Info,
  KeyRound,
  Layers,
  Library,
  Monitor,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Terminal,
  X,
} from "lucide-preact";
import { Github } from "../icons/GitHostIcons.js";
import { fetchOnboardingReadiness, installOnboardingDependencies } from "../../../lib/api/dashboard-api.js";
import { fetchSystemSettings, saveSystemSettings } from "../../lib/settings-api.js";
import { ONBOARDING_OPEN_EVENT, ONBOARDING_STORAGE_KEY, startDashboardTour } from "../../lib/onboarding-control.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useOnboardingState } from "../../hooks/useOnboardingState.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { OnboardingIntro } from "./OnboardingIntro.js";
import { ProviderBrandIcon } from "../providers/ProviderBrandIcon.js";
import { ProviderInstanceCard } from "../settings/ProviderInstanceCard.js";
import { TerminalLoginModal } from "../settings/TerminalLoginModal.js";
import { sanitizeSystemProviderConfig } from "../../lib/provider-runtime-preview.js";
import { PillChoiceGroup, Row, SecretInput, SelectInput, TextInput, Toggle } from "../settings/SettingsFormFields.js";
import { applyAppearanceSettings } from "../../lib/apply-appearance.js";
import { clearAppearancePreview, publishAppearancePreview } from "../../lib/appearance-preview.js";
import { SectionCard } from "../settings/panels/SharedPanelComponents.js";
import { JiraIcon } from "../icons/JiraIcon.js";
import { OnboardingInstallationStep } from "./OnboardingInstallationStep.js";
import { OnboardingAppearanceStep } from "./OnboardingAppearanceStep.js";
import { Dialog } from "../ui/Dialog.js";
import { fetchRuntimeAssetsStatus, prepareProviderTool } from "../../lib/runtime-assets-api.js";
import { isDeprecatedProvider } from "../../lib/provider-lifecycle.js";
import { useOnboardingMessages } from "../../i18n/messages/onboarding.js";

type IntroPhase = "intro" | "transitioning" | "onboarding";
import type {
  DashboardExperienceMode,
  OnboardingDependencyInstallerResult,
  OnboardingDependencyInstallMode,
  OnboardingProviderCredentialStatus,
  OnboardingRuntimeReadiness,
  ProviderConfigId,
  ProviderId,
  ProviderToolStatus,
  RuntimeAssetsStatus,
  ProjectSettings,
  SystemSettings,
} from "../../../types.js";
import { getSafeUrl } from "../../lib/safe-url.js";
import {
  applyOnboardingExperienceModeDefaults,
  buildProviderConfigId,
  getEasyRecommendedProvider,
  getSystemProvidersByType,
  syncProjectProvidersToIntegrationCatalog
} from "../../lib/onboarding-settings-draft.js";
import { dashboardExperienceModeOptions } from "../../lib/experience-mode.js";
import {
  createProjectProviderDraft,
  createSystemProviderDraft,
  getProviderDefaultAuthPath,
  getProviderInstanceLabel,
  getProviderTypeLabel,
  sortProviderConfigEntries,
} from "../../lib/settings-view-models.js";
import {
  cloneSystemSettings,
  defaultOnboardingReadiness,
  onboardingProviderTypes,
  useOnboardingStepFlow,
  type StepId,
} from "./use-onboarding-step-flow.js";

const CODEUX_REPO_URL = "https://github.com/codeux-ai/codeux";

type OnboardingValidationResult = {
  valid: true;
} | {
  valid: false;
  message: string;
  focusSelector?: string;
};

const LICENSE_TEXT = `MIT License

Copyright (c) 2026 Pierre Voss

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const DeepOceanBackground = lazy(async () => {
  const mod = await import("../chat/DeepOceanBackground.js");
  return { default: mod.DeepOceanBackground as FunctionComponent<{ forceDark?: boolean; className?: string }> };
});

const DEFAULT_JIRA_SETTINGS: SystemSettings["integrations"]["jira"] = {
  host: "",
  email: "",
  apiToken: "",
  autoTransitionLinkedIssuesOnImport: true,
  importTransitionName: "In Work",
  autoCloseLinkedIssues: false,
  defaultProject: "",
  closeTransitionName: "Done",
};

const providerMountFields: Partial<Record<ProviderId, keyof SystemSettings["defaults"]["cliWorkflow"]>> = {
  gemini: "containerMountGeminiAuth",
  codex: "containerMountCodexAuth",
  "claude-code": "containerMountClaudeCodeAuth",
  "qwen-code": "containerMountQwenCodeAuth",
  opencode: "containerMountOpenCodeAuth",
  antigravity: "containerMountAntigravityAuth",
};

const providerLabels: Record<ProviderId, string> = {
  jules: "Jules",
  gemini: "Gemini",
  codex: "Codex",
  "claude-code": "Claude Code",
  "qwen-code": "Qwen Code",
  opencode: "OpenCode",
  antigravity: "Antigravity",
  "mockup-cli": "Mockup CLI",
};

const PROVIDER_TYPES = onboardingProviderTypes;
const EASY_PROVIDER_TYPES: ProviderId[] = ["antigravity", "codex", "claude-code", "qwen-code", "opencode"];

const getProviderWatermark = (providerId: ProviderId): string => (
  providerId === "jules" ? "JLS"
    : providerId === "gemini" ? "GMN"
      : providerId === "codex" ? "CDX"
        : providerId === "qwen-code" ? "QWN"
          : providerId === "opencode" ? "OPC"
            : providerId === "antigravity" ? "AGY"
              : "CLD"
);

const createEasyDashboardProviderDraft = (
  providerId: ProviderId,
  providerConfigId: ProviderConfigId,
): SystemSettings["integrations"]["providers"][ProviderConfigId] => sanitizeSystemProviderConfig({
  ...createSystemProviderDraft(providerId, providerLabels[providerId]),
  authType: "dashboardAuth",
  mountAuth: true,
  authPath: `~/.code-ux/credentials/${providerConfigId}`,
});

const getEasyAuthUpdates = (
  providerConfigId: ProviderConfigId,
  providerId: ProviderId,
  authType: "dashboardAuth" | "localAuth",
  currentAuthPath: string,
): Partial<SystemSettings["integrations"]["providers"][ProviderConfigId]> => ({
  authType,
  mountAuth: true,
  authPath: authType === "dashboardAuth"
    ? `~/.code-ux/credentials/${providerConfigId}`
    : (currentAuthPath && !currentAuthPath.includes(".code-ux/credentials/")
      ? currentAuthPath
      : getProviderDefaultAuthPath(providerId)),
});

const EasyProviderAuthCard: FunctionComponent<{
  providerConfigId: ProviderConfigId;
  provider: SystemSettings["integrations"]["providers"][ProviderConfigId];
  authMode: "dashboardAuth" | "localAuth";
  selected: boolean;
  readinessStatus?: OnboardingProviderCredentialStatus;
  toolStatus?: ProviderToolStatus;
  onSelect: () => void;
  onAuthModeChange: (authMode: "dashboardAuth" | "localAuth") => void;
  onUpdate: (updates: Partial<SystemSettings["integrations"]["providers"][ProviderConfigId]>) => void;
}> = ({ providerConfigId, provider, authMode, selected, readinessStatus, toolStatus, onSelect, onAuthModeChange, onUpdate }) => {
  const { t } = useOnboardingMessages();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const providerLabel = providerLabels[provider.provider];
  const deprecated = isDeprecatedProvider(provider.provider);

  const applyAuthMode = (value: string): void => {
    const nextAuthMode = value === "localAuth" ? "localAuth" : "dashboardAuth";
    onAuthModeChange(nextAuthMode);
  };

  const openLogin = (): void => {
    onSelect();
    onAuthModeChange("dashboardAuth");
    setShowLoginModal(true);
  };

  return (
    <div data-onboarding-card className={`relative overflow-hidden rounded-[2rem] border p-5 shadow-[0_18px_50px_rgba(15,23,42,0.055)] transition-colors dark:bg-white/[0.04] ${selected ? "border-signal-500/30 bg-signal-500/10" : "border-black/[0.06] bg-white/78 dark:border-white/[0.06]"}`}>
      <div aria-hidden className="pointer-events-none absolute -right-6 -top-8 font-display text-[7rem] font-black leading-none tracking-tight text-black/[0.025] dark:text-white/[0.025]">
        {getProviderWatermark(provider.provider)}
      </div>
      <div className="relative z-10 flex flex-wrap items-start justify-between gap-3 border-b border-black/[0.06] pb-4 dark:border-white/[0.06]">
        <div className="flex min-w-0 items-start gap-3">
          <ProviderBrandIcon id={provider.provider} />
          <div className="min-w-0">
            <div className="text-base font-black text-slate-900 dark:text-white">{providerLabel}</div>
            <div className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
              {readinessStatus?.detectedFiles.length ? t("credentialsDetected") : t("readyForDashboardLogin")}
            </div>
          </div>
        </div>
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          aria-label={selected ? t("selectedProvider", { provider: providerLabel }) : t("selectProviderLogin", { provider: providerLabel })}
          onClick={onSelect}
          className={`rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 ${selected ? "border border-signal-500/20 bg-signal-500/10 text-signal-700 dark:text-signal-200" : "border border-black/[0.06] bg-white/60 text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300"}`}
        >
          {selected ? t("providerSelected") : t("select")}
        </button>
      </div>

      <div className="relative z-10 mt-4 space-y-3">
        {deprecated ? (
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs font-semibold leading-relaxed text-amber-800 dark:text-amber-200">
            <div className="font-black uppercase tracking-[0.14em]">{t("deprecated")}</div>
            <div className="mt-1">{t("geminiDeprecated")}</div>
          </div>
        ) : null}
        {toolStatus ? (
          <div className={`rounded-xl border px-3 py-2 text-xs font-semibold ${toolStatus.state === "failed" ? "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300" : toolStatus.state === "ready" ? "border-signal-500/20 bg-signal-500/10 text-signal-700 dark:text-signal-300" : "border-black/[0.06] bg-black/[0.025] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300"}`}>
            {toolStatus.stepText}
          </div>
        ) : null}
        <Row label={t("authenticationMode")}>
          <SelectInput
            value={authMode}
            onChange={applyAuthMode}
            aria-label={t("providerAuthenticationMode", { provider: providerLabel })}
            options={[
              { value: "dashboardAuth", label: t("dashboardLogin") },
              { value: "localAuth", label: t("localCopy") },
            ]}
          />
        </Row>
        {authMode === "dashboardAuth" ? (
          <button
            type="button"
            onClick={openLogin}
            aria-label={t("connectLoginProvider", { provider: providerLabel })}
            aria-haspopup="dialog"
            aria-expanded={showLoginModal}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-signal-500 px-4 py-3 text-sm font-black text-white shadow-lg transition-colors hover:bg-signal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-[0.98] dark:text-void-950 dark:focus-visible:ring-offset-void-900"
          >
            <Terminal className="h-4 w-4" />
            {t("connectLogin")}
          </button>
        ) : (
          <div className="rounded-2xl border border-black/[0.06] bg-white/60 px-4 py-3 text-sm font-semibold text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
            {t("localCopyBody")}
          </div>
        )}
      </div>

      {showLoginModal ? (
        <TerminalLoginModal
          providerConfigId={providerConfigId}
          providerId={provider.provider}
          providerName={providerLabel}
          onClose={() => setShowLoginModal(false)}
          onSuccess={() => onUpdate({ lastLoginAt: Date.now() })}
        />
      ) : null}
    </div>
  );
};

const platform = (typeof window !== "undefined" && window.codeUxDesktop?.platform) || "linux";

const getOSInfo = (plat: string) => {
  const isMac = plat === "darwin";
  const isWindows = plat === "win32";

  let osLabel = "Linux";
  if (isMac) osLabel = "macOS";
  if (isWindows) osLabel = "Windows";

  const dockerDesktopLink = isMac
    ? "https://docs.docker.com/desktop/install/mac-install/"
    : isWindows
    ? "https://docs.docker.com/desktop/install/windows-install/"
    : "https://docs.docker.com/desktop/install/linux-install/";

  const dockerDownloadLink = isMac
    ? "https://www.docker.com/products/docker-desktop/"
    : isWindows
    ? "https://www.docker.com/products/docker-desktop/"
    : "https://docs.docker.com/engine/install/";

  const gitLink = isMac
    ? "https://git-scm.com/download/mac"
    : isWindows
    ? "https://git-scm.com/download/win"
    : "https://git-scm.com/download/linux";

  const gitInstruction = isMac
    ? "Install via Homebrew: brew install git"
    : isWindows
    ? "Run the Git for Windows installer."
    : "Install via apt or dnf: sudo apt install git";

  return {
    osLabel,
    dockerDesktopLink,
    dockerDownloadLink,
    gitLink,
    gitInstruction,
  };
};

const normalizeOnboardingReadiness = (nextReadiness: OnboardingRuntimeReadiness): OnboardingRuntimeReadiness => {
  const installers = nextReadiness.installers ?? defaultOnboardingReadiness.installers;
  return {
    ...defaultOnboardingReadiness,
    ...nextReadiness,
    cluster: {
      ...defaultOnboardingReadiness.cluster,
      ...nextReadiness.cluster,
    },
    dependencies: nextReadiness.dependencies ?? [],
    providers: nextReadiness.providers ?? [],
    installers: {
      ...defaultOnboardingReadiness.installers,
      ...installers,
      options: installers.options ?? [],
    },
  };
};

export const OnboardingExperience: FunctionComponent = () => {
  const { t, tp } = useOnboardingMessages();
  const navigate = useNavigate();
  const shellRef = useRef<HTMLElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const {
    dispatch,
    open,
    activeStep,
    lastStep,
    experienceMode,
    readiness,
    settings,
    selectedProviders,
    selectedProviderTypes,
    draftDirty,
    saving,
    error,
    activeStepData: active,
    setActiveStep,
    goToNextStep,
    goToPreviousStep,
    steps,
    updateSettings,
  } = useOnboardingStepFlow();
  const [introPhase, setIntroPhase] = useState<IntroPhase>("intro");
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const [runningInstallMode, setRunningInstallMode] = useState<OnboardingDependencyInstallMode | null>(null);
  const [lastInstallResult, setLastInstallResult] = useState<OnboardingDependencyInstallerResult | null>(null);
  const [failedInstallMode, setFailedInstallMode] = useState<OnboardingDependencyInstallMode | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [dismissalNotice, setDismissalNotice] = useState<string | null>(null);
  const [runtimeAssets, setRuntimeAssets] = useState<RuntimeAssetsStatus | null>(null);
  const [easyProviderAuthModes, setEasyProviderAuthModes] = useState<Partial<Record<ProviderId, "dashboardAuth" | "localAuth">>>({});
  const reducedMotion = useReducedMotion();
  const gsapTokens = useGsapInteractionTokens();
  const interactionTokens = useInteractionTokens();
  const localizedProviderDescriptions: Record<ProviderId, string> = {
    jules: t("providerDescriptionJules"), gemini: t("providerDescriptionGemini"), codex: t("providerDescriptionCodex"),
    "claude-code": t("providerDescriptionClaude"), "qwen-code": t("providerDescriptionQwen"), opencode: t("providerDescriptionOpenCode"),
    antigravity: t("providerDescriptionAntigravity"), "mockup-cli": t("providerDescriptionMock"),
  };
  const validationRef = useRef<HTMLDivElement>(null);
  const validationFocusSelectorRef = useRef<string | null>(null);
  const openRef = useRef(open);
  const mountedRef = useRef(true);
  const loadRequestRef = useRef(0);
  const installRequestRef = useRef(0);
  const providerPreparationRequestRef = useRef(0);
  const saveRequestRef = useRef(0);
  const {
    state: onboardingUserState,
    loading: onboardingStateLoading,
    markCompleted: markOnboardingCompleted,
    reset: resetOnboardingState,
  } = useOnboardingState();

  useEffect(() => {
    openRef.current = open;
    if (open) {
      setDismissalNotice(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const requestGeneration = providerPreparationRequestRef.current;
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      const next = await fetchRuntimeAssetsStatus().catch(() => null);
      if (!cancelled && next && openRef.current && requestGeneration === providerPreparationRequestRef.current) {
        setRuntimeAssets(next);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [open]);

  const beginProviderPreparation = (provider: ProviderId): void => {
    if (provider === "jules" || provider === "mockup-cli") return;
    const requestGeneration = providerPreparationRequestRef.current;
    void prepareProviderTool(provider)
      .then(() => fetchRuntimeAssetsStatus())
      .then((next) => {
        if (mountedRef.current && openRef.current && requestGeneration === providerPreparationRequestRef.current) {
          setRuntimeAssets(next);
        }
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    if (!open) {
      loadRequestRef.current += 1;
      installRequestRef.current += 1;
      providerPreparationRequestRef.current += 1;
      saveRequestRef.current += 1;
      clearAppearancePreview();
    }
  }, [open]);

  useEffect(() => () => {
    mountedRef.current = false;
    loadRequestRef.current += 1;
    installRequestRef.current += 1;
    providerPreparationRequestRef.current += 1;
    saveRequestRef.current += 1;
    clearAppearancePreview();
  }, []);

  const closeOnboarding = (): void => {
    openRef.current = false;
    loadRequestRef.current += 1;
    installRequestRef.current += 1;
    providerPreparationRequestRef.current += 1;
    saveRequestRef.current += 1;
    clearAppearancePreview();
    dispatch({ type: "close" });
  };

  const dismissalBlockedMessage = saving
    ? t("closeUnavailableSaving")
    : runningInstallMode
      ? t("closeUnavailableInstalling")
      : dismissing
        ? t("closeUnavailableCancelling")
        : null;
  const dismissalBlocked = dismissalBlockedMessage !== null;

  const completeCancellation = async (): Promise<void> => {
    if (dismissalBlocked) {
      setDismissalNotice(dismissalBlockedMessage);
      return;
    }
    setDismissing(true);
    setDismissalNotice(t("closeUnavailableCancelling"));
    try {
      await markOnboardingCompleted("cancel");
      if (!mountedRef.current || !openRef.current) {
        return;
      }
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
      setShowDiscardConfirmation(false);
      closeOnboarding();
    } catch (cancelError) {
      if (mountedRef.current && openRef.current) {
        setDismissalNotice(t("cancelFailedAnnouncement", {
          message: cancelError instanceof Error ? cancelError.message : String(cancelError),
        }));
      }
    } finally {
      if (mountedRef.current && openRef.current) {
        setDismissing(false);
      }
    }
  };

  const requestClose = (): void => {
    if (dismissalBlocked) {
      setDismissalNotice(dismissalBlockedMessage);
      return;
    }
    setDismissalNotice(null);
    if (draftDirty) {
      setShowDiscardConfirmation(true);
      return;
    }
    void completeCancellation();
  };

  useEffect(() => {
    if (onboardingStateLoading) {
      return;
    }
    dispatch({ type: "set-open", open: !onboardingUserState.completed });
  }, [onboardingStateLoading, onboardingUserState.completed]);

  useEffect(() => {
    const handleOpen = () => {
      void resetOnboardingState();
      dispatch({ type: "reset-and-open" });
      openRef.current = true;
      loadRequestRef.current += 1;
      installRequestRef.current += 1;
      providerPreparationRequestRef.current += 1;
      saveRequestRef.current += 1;
      setShowDiscardConfirmation(false);
      setDismissing(false);
      setDismissalNotice(null);
      setCheckingReadiness(false);
      setRunningInstallMode(null);
      setLastInstallResult(null);
      setFailedInstallMode(null);
      setInstallError(null);
      setValidationMessage(null);
      setRuntimeAssets(null);
      setEasyProviderAuthModes({});
      setIntroPhase("intro");
    };
    window.addEventListener(ONBOARDING_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(ONBOARDING_OPEN_EVENT, handleOpen);
  }, [resetOnboardingState]);

  const handleIntroExitStart = () => {
    setIntroPhase("transitioning");
  };

  const handleIntroComplete = () => {
    setIntroPhase("onboarding");
  };

  const load = async (): Promise<void> => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setCheckingReadiness(true);
    try {
      const [nextReadiness, nextSettings] = await Promise.all([
        fetchOnboardingReadiness(),
        fetchSystemSettings(),
      ]);
      if (!mountedRef.current || requestId !== loadRequestRef.current || !openRef.current) {
        return;
      }
      dispatch({ type: "load-success", readiness: normalizeOnboardingReadiness(nextReadiness), settings: nextSettings });
      applyAppearanceSettings(nextSettings.defaults.appearance);
      publishAppearancePreview(nextSettings.defaults.appearance);
    } catch (loadError) {
      if (!mountedRef.current || requestId !== loadRequestRef.current || !openRef.current) {
        return;
      }
      dispatch({ type: "load-failure", error: loadError instanceof Error ? loadError.message : String(loadError) });
    } finally {
      if (mountedRef.current && requestId === loadRequestRef.current && openRef.current) {
        setCheckingReadiness(false);
      }
    }
  };

  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open]);

  const runDependencyInstall = async (mode: OnboardingDependencyInstallMode): Promise<void> => {
    const requestId = installRequestRef.current + 1;
    installRequestRef.current = requestId;
    setRunningInstallMode(mode);
    setFailedInstallMode(null);
    setInstallError(null);
    try {
      const result = await installOnboardingDependencies(mode);
      if (!mountedRef.current || !openRef.current || requestId !== installRequestRef.current) {
        return;
      }
      setLastInstallResult(result);
      await load();
    } catch (dependencyInstallError) {
      if (mountedRef.current && openRef.current && requestId === installRequestRef.current) {
        setFailedInstallMode(mode);
        setInstallError(dependencyInstallError instanceof Error ? dependencyInstallError.message : String(dependencyInstallError));
      }
    } finally {
      if (mountedRef.current && openRef.current && requestId === installRequestRef.current) {
        setRunningInstallMode(null);
      }
    }
  };

  const handleAutoInstall = (): void => {
    const recommendedOption = readiness.installers.options.find((option) => option.mode === readiness.installers.recommendedMode);
    if (!recommendedOption?.available) {
      setInstallError(t("noRecommendedInstaller"));
      return;
    }
    void runDependencyInstall(recommendedOption.mode);
  };

  useLayoutEffect(() => {
    if (!open || !shellRef.current) {
      return;
    }
    const ctx = gsap.context(() => {
      gsap.fromTo(
        shellRef.current,
        {
          opacity: MODAL_MOTION.entry.opacityStart,
          y: reducedMotion ? 0 : MODAL_MOTION.entry.yStart,
          scale: reducedMotion ? 1 : MODAL_MOTION.entry.scaleStart,
          filter: reducedMotion ? MODAL_MOTION.entry.filterEnd : MODAL_MOTION.entry.filterStart,
        },
        {
          opacity: MODAL_MOTION.entry.opacityEnd,
          y: MODAL_MOTION.entry.yEnd,
          scale: MODAL_MOTION.entry.scaleEnd,
          filter: MODAL_MOTION.entry.filterEnd,
          duration: gsapTokens.enterExit.duration,
          ease: gsapTokens.enterExit.ease,
          clearProps: "filter",
        },
      );
      if (sideRef.current) {
        gsap.fromTo(
          sideRef.current.querySelectorAll("[data-step-item], [data-sidebar-copy]"),
          { opacity: 0, x: reducedMotion ? 0 : -18 },
          { opacity: 1, x: 0, duration: gsapTokens.selectionMovement.duration, ease: gsapTokens.selectionMovement.ease },
        );
      }
    });
    return () => ctx.revert();
  }, [open, reducedMotion, gsapTokens.enterExit.duration, gsapTokens.enterExit.ease, gsapTokens.selectionMovement.duration, gsapTokens.selectionMovement.ease]);

  useLayoutEffect(() => {
    if (!contentRef.current) {
      return;
    }
    const direction = activeStep >= lastStep ? 1 : -1;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        contentRef.current!.querySelectorAll("[data-onboarding-card]"),
        { opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 18 * direction, scale: 1 },
        { opacity: 1, y: 0, scale: 1, duration: gsapTokens.selectionMovement.duration, ease: gsapTokens.selectionMovement.ease },
      );
    });
    return () => ctx.revert();
  }, [activeStep, lastStep, selectedProviders.length, settings, reducedMotion, gsapTokens.selectionMovement.duration, gsapTokens.selectionMovement.ease]);

  useEffect(() => {
    setValidationMessage(null);
    validationFocusSelectorRef.current = null;
  }, [activeStep]);

  useLayoutEffect(() => {
    if (!validationMessage) {
      return;
    }
    const focusSelector = validationFocusSelectorRef.current;
    const focusTarget = focusSelector
      ? contentRef.current?.querySelector<HTMLElement>(focusSelector)
        || shellRef.current?.querySelector<HTMLElement>(focusSelector)
      : null;
    const target = focusTarget || validationRef.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
  }, [reducedMotion, validationMessage]);

  useLayoutEffect(() => {
    if (!open || introPhase !== "onboarding") {
      return;
    }
    stepHeadingRef.current?.focus({ preventScroll: true });
  }, [activeStep, introPhase, open]);

  const readinessByProvider = useMemo(
    () => Object.fromEntries(readiness.providers.map((provider) => [provider.provider, provider])) as Partial<Record<ProviderId, OnboardingProviderCredentialStatus>>,
    [readiness.providers],
  );
  const toolStatusByProvider = useMemo(
    () => Object.fromEntries((runtimeAssets?.providers ?? []).map((status) => [status.provider, status])) as Partial<Record<ProviderId, ProviderToolStatus>>,
    [runtimeAssets],
  );
  const easyRecommendedProvider = useMemo(
    () => getEasyRecommendedProvider(readiness.providers, settings),
    [readiness.providers, settings],
  );

  const applyExperienceMode = (
    mode: DashboardExperienceMode,
    options: { useGithub?: boolean; manageGithubPrWorkflow?: boolean } = {},
  ): void => {
    const easyUseGithubDefault = options.useGithub ?? false;
    dispatch({ type: "select-experience-mode", mode });
    if (mode === "EASY") {
      setEasyProviderAuthModes({});
      dispatch({ type: "set-selected-providers", providers: [easyRecommendedProvider] });
      beginProviderPreparation(easyRecommendedProvider);
    }
    updateSettings((current) => applyOnboardingExperienceModeDefaults(current, mode, {
      recommendedProvider: easyRecommendedProvider,
      providerAuthMode: "dashboardAuth",
      useGithub: mode === "EASY" ? easyUseGithubDefault : options.useGithub,
      manageGithubPrWorkflow: mode === "EASY" ? options.manageGithubPrWorkflow ?? false : options.manageGithubPrWorkflow,
    }));
  };

  const updateAppearance = (updates: Partial<SystemSettings["defaults"]["appearance"]>) => {
    updateSettings((current) => {
      const nextAppearance = {
        ...current.defaults.appearance,
        ...updates,
      };
      applyAppearanceSettings(nextAppearance);
      publishAppearancePreview(nextAppearance);
      return {
        ...current,
        defaults: {
          ...current.defaults,
          appearance: nextAppearance,
        },
      };
    });
  };

  const toggleProvider = (provider: ProviderId) => {
    if (!selectedProviders.includes(provider)) {
      ensureProviderInstance(provider);
      beginProviderPreparation(provider);
    }
    dispatch({ type: "toggle-provider", provider });
  };

  const updateIntegrationProviders = (
    transform: (providers: SystemSettings["integrations"]["providers"]) => SystemSettings["integrations"]["providers"],
  ) => {
    updateSettings((current) => {
      const nextProviders = transform({ ...current.integrations.providers });
      return {
        ...current,
        integrations: {
          ...current.integrations,
          providers: nextProviders,
        },
        defaults: syncProjectProvidersToIntegrationCatalog(current, nextProviders),
      };
    });
  };

  const ensureProviderInstance = (provider: ProviderId): void => {
    updateSettings((current) => {
      if (Object.values(current.integrations.providers).some((entry) => entry.provider === provider)) {
        return current;
      }
      const providerConfigId = provider;
      const nextProviders = {
        ...current.integrations.providers,
        [providerConfigId]: createSystemProviderDraft(provider, providerLabels[provider]),
      };
      return {
        ...current,
        integrations: {
          ...current.integrations,
          providers: nextProviders,
        },
        defaults: syncProjectProvidersToIntegrationCatalog(current, nextProviders),
      };
    });
  };

  const addProviderInstance = (provider: ProviderId): void => {
    const count = getSystemProvidersByType(settings, provider).length + 1;
    const providerConfigId = buildProviderConfigId(provider);
    const providerName = `${getProviderTypeLabel(provider)} ${count}`;
    updateIntegrationProviders((providers) => ({
      ...providers,
      [providerConfigId]: createSystemProviderDraft(provider, providerName),
    }));
    dispatch({ type: "select-provider", provider });
  };

  const removeProviderInstance = (providerConfigId: ProviderConfigId): void => {
    updateIntegrationProviders((providers) => {
      const nextProviders = { ...providers };
      delete nextProviders[providerConfigId];
      return nextProviders;
    });
  };

  const configureProviderInstance = (
    providerConfigId: ProviderConfigId,
    updates: Partial<SystemSettings["integrations"]["providers"][ProviderConfigId]>,
  ) => {
    updateSettings((current) => {
      const provider = current.integrations.providers[providerConfigId];
      if (!provider) {
        return current;
      }
      const nextProviders = {
        ...current.integrations.providers,
        [providerConfigId]: sanitizeSystemProviderConfig({
          ...provider,
          ...updates,
        }),
      };
      const mountField = providerMountFields[provider.provider];
      const syncedDefaults = syncProjectProvidersToIntegrationCatalog(current, nextProviders);
      const sanitizedProvider = nextProviders[providerConfigId];
      if (mountField && sanitizedProvider.mountAuth !== undefined) {
        syncedDefaults.cliWorkflow[mountField] = sanitizedProvider.mountAuth as never;
      }
      return {
        ...current,
        integrations: {
          ...current.integrations,
          providers: nextProviders,
        },
        defaults: syncedDefaults,
      };
    });
  };

  const configureEasyProviderInstance = (
    providerId: ProviderId,
    providerConfigId: ProviderConfigId,
    updates: Partial<SystemSettings["integrations"]["providers"][ProviderConfigId]>,
  ): void => {
    dispatch({ type: "set-selected-providers", providers: [providerId] });
    beginProviderPreparation(providerId);
    updateSettings((current) => {
      const provider = current.integrations.providers[providerConfigId]
        ?? createEasyDashboardProviderDraft(providerId, providerConfigId);
      const nextProviders = {
        ...current.integrations.providers,
        [providerConfigId]: sanitizeSystemProviderConfig({
          ...provider,
          ...updates,
        }),
      };
      const syncedDefaults = syncProjectProvidersToIntegrationCatalog(current, nextProviders);
      return {
        ...current,
        integrations: {
          ...current.integrations,
          providers: nextProviders,
        },
        defaults: syncedDefaults,
      };
    });
  };

  const configureProjectProvider = (
    providerConfigId: ProviderConfigId,
    updates: Partial<ProjectSettings["aiProvider"]["providers"][ProviderConfigId]>,
  ) => {
    updateSettings((current) => {
      const projectProvider = current.defaults.aiProvider.providers[providerConfigId];
      if (!projectProvider) {
        return current;
      }
      return {
        ...current,
        defaults: {
          ...current.defaults,
          aiProvider: {
            ...current.defaults.aiProvider,
            providers: {
              ...current.defaults.aiProvider.providers,
              [providerConfigId]: {
                ...projectProvider,
                ...updates,
              },
            },
          },
        },
      };
    });
  };

  const updateCliWorkflow = (updates: Partial<ProjectSettings["cliWorkflow"]>) => {
    updateSettings((current) => ({
      ...current,
      defaults: {
        ...current.defaults,
        cliWorkflow: {
          ...current.defaults.cliWorkflow,
          ...updates,
        },
      },
    }));
  };

  const updateJira = (updates: Partial<SystemSettings["integrations"]["jira"]>) => {
    updateSettings((current) => ({
      ...current,
      integrations: {
        ...current.integrations,
        jira: {
          ...(current.integrations.jira || DEFAULT_JIRA_SETTINGS),
          ...updates,
        },
      },
    }));
  };

  const gitMode = settings?.defaults.cliWorkflow.gitMode === "local" ? "local" : "remote";
  const isEasyMode = experienceMode === "EASY";
  const easySelectedProvider = selectedProviderTypes.find((provider) => EASY_PROVIDER_TYPES.includes(provider)) ?? easyRecommendedProvider;
  const easyUseGithub = settings ? settings.defaults.cliWorkflow.gitMode !== "local" : true;
  const easyManageGithubPrWorkflow = settings ? settings.defaults.git.autoCreatePr : true;

  const enabledProviderInstances = settings
    ? sortProviderConfigEntries(Object.entries(settings.defaults.aiProvider.providers))
      .filter(([, provider]) => provider.enabled)
    : [];

  const getValidationResult = (): OnboardingValidationResult => {
    if (!settings) {
      return { valid: true };
    }
    if (active.id === "jira") {
      const jiraHasAnyValue = Boolean(jiraSettings.host.trim() || jiraSettings.email.trim() || jiraSettings.apiToken.trim() || jiraSettings.defaultProject.trim());
      if (jiraHasAnyValue && !jiraSettings.host.trim()) {
        return {
          valid: false,
          message: t("jiraUrlValidation"),
          focusSelector: `[aria-label="${t("jiraSiteUrl")}"]`,
        };
      }
      if (jiraHasAnyValue && !jiraSettings.apiToken.trim()) {
        return {
          valid: false,
          message: t("jiraTokenValidation"),
          focusSelector: `[aria-label="${t("jiraApiToken")}"]`,
        };
      }
    } else if (active.id === "defaults" && enabledProviderInstances.length === 0) {
      return {
        valid: false,
        message: t("providersValidation"),
        focusSelector: `[aria-label="${t("goToStep", { step: t("stepProviders") })}"]`,
      };
    }
    return { valid: true };
  };

  const validateActiveStep = (): boolean => {
    const result = getValidationResult();
    if (result.valid) {
      return true;
    }
    validationFocusSelectorRef.current = result.focusSelector ?? null;
    setValidationMessage(result.message);
    return false;
  };

  const handleContinue = () => {
    if (validateActiveStep()) {
      goToNextStep();
    }
  };

  const applyAndClose = async () => {
    if (saving) {
      return;
    }
    if (!validateActiveStep()) {
      return;
    }
    if (!settings) {
      const requestId = saveRequestRef.current + 1;
      saveRequestRef.current = requestId;
      dispatch({ type: "set-saving", saving: true });
      try {
        await markOnboardingCompleted("complete");
        if (!mountedRef.current || !openRef.current || requestId !== saveRequestRef.current) {
          return;
        }
        window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
        closeOnboarding();
        await navigate({ to: experienceMode === "EASY" ? "/chat" : "/" });
        startDashboardTour();
      } catch (saveError) {
        if (mountedRef.current && openRef.current && requestId === saveRequestRef.current) {
          dispatch({ type: "set-error", error: saveError instanceof Error ? saveError.message : String(saveError) });
        }
      } finally {
        if (mountedRef.current && openRef.current && requestId === saveRequestRef.current) {
          dispatch({ type: "set-saving", saving: false });
        }
      }
      return;
    }
    const requestId = saveRequestRef.current + 1;
    saveRequestRef.current = requestId;
    dispatch({ type: "set-saving", saving: true });
    try {
      let nextSettings = applyOnboardingExperienceModeDefaults(cloneSystemSettings(settings), experienceMode, {
        recommendedProvider: easySelectedProvider,
        providerAuthMode: easyProviderAuthModes[easySelectedProvider] ?? "dashboardAuth",
        useGithub: settings.defaults.cliWorkflow.gitMode !== "local",
        manageGithubPrWorkflow: settings.defaults.git.autoCreatePr,
      });
      for (const provider of selectedProviderTypes) {
        if (!Object.values(nextSettings.integrations.providers).some((entry) => entry.provider === provider)) {
          nextSettings.integrations.providers[provider] = createSystemProviderDraft(provider, providerLabels[provider]);
          nextSettings.defaults = syncProjectProvidersToIntegrationCatalog(nextSettings, nextSettings.integrations.providers);
        }
        const readinessStatus = readinessByProvider[provider];
        const providerConfigIds = Object.entries(nextSettings.integrations.providers)
          .filter(([, entry]) => entry.provider === provider)
          .map(([providerConfigId]) => providerConfigId);
        for (const providerConfigId of providerConfigIds) {
          const integrationProvider = nextSettings.integrations.providers[providerConfigId];
          const projectProvider = nextSettings.defaults.aiProvider.providers[providerConfigId];
          const mountField = providerMountFields[provider];
          if (integrationProvider && readinessStatus?.available && !integrationProvider.apiKey.trim()) {
            nextSettings.integrations.providers[providerConfigId] = {
              ...integrationProvider,
              mountAuth: integrationProvider.mountAuth || provider !== "jules",
              authPath: integrationProvider.authPath || readinessStatus.authPath,
            };
          }
          if (projectProvider) {
            nextSettings.defaults.aiProvider.providers[providerConfigId] = {
              ...projectProvider,
              enabled: true,
            };
          }
          if (mountField && readinessStatus?.available) {
            nextSettings.defaults.cliWorkflow[mountField] = true as never;
          }
        }
      }
      for (const [providerConfigId, projectProvider] of Object.entries(nextSettings.defaults.aiProvider.providers)) {
        if (!selectedProviderTypes.includes(projectProvider.provider)) {
          nextSettings.defaults.aiProvider.providers[providerConfigId] = {
            ...projectProvider,
            enabled: false,
          };
        }
      }
      nextSettings.defaults = syncProjectProvidersToIntegrationCatalog(nextSettings, nextSettings.integrations.providers);
      for (const [providerConfigId, projectProvider] of Object.entries(nextSettings.defaults.aiProvider.providers)) {
        nextSettings.defaults.aiProvider.providers[providerConfigId] = {
          ...projectProvider,
          enabled: selectedProviderTypes.includes(projectProvider.provider),
        };
      }
      // Respect the explicit worker provider picked on the Default providers step; only
      // fall back to the first enabled CLI provider when that choice is no longer valid.
      const firstSelectedCliProvider = Object.entries(nextSettings.defaults.aiProvider.providers)
        .find(([, provider]) => provider.enabled && provider.provider !== "jules")?.[0];
      const chosenWorker = nextSettings.defaults.workers.virtualWorkerProvider;
      const chosenWorkerProvider = nextSettings.defaults.aiProvider.providers[chosenWorker];
      const chosenWorkerValid = Boolean(chosenWorkerProvider?.enabled && chosenWorkerProvider.provider !== "jules");
      if (!chosenWorkerValid && firstSelectedCliProvider) {
        nextSettings.defaults.workers.virtualWorkerProvider = firstSelectedCliProvider;
      }
      for (const [providerConfigId, integrationProvider] of Object.entries(nextSettings.integrations.providers)) {
        nextSettings.integrations.providers[providerConfigId] = sanitizeSystemProviderConfig(integrationProvider);
      }
      nextSettings = await saveSystemSettings(nextSettings);
      if (!mountedRef.current || !openRef.current || requestId !== saveRequestRef.current) {
        return;
      }
      dispatch({ type: "set-settings", settings: nextSettings });
      await markOnboardingCompleted("complete");
      if (!mountedRef.current || !openRef.current || requestId !== saveRequestRef.current) {
        return;
      }
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
      closeOnboarding();
      await navigate({ to: experienceMode === "EASY" ? "/chat" : "/" });
      startDashboardTour();
    } catch (saveError) {
      if (mountedRef.current && openRef.current && requestId === saveRequestRef.current) {
        dispatch({ type: "set-error", error: saveError instanceof Error ? saveError.message : String(saveError) });
      }
    } finally {
      if (mountedRef.current && openRef.current && requestId === saveRequestRef.current) {
        dispatch({ type: "set-saving", saving: false });
      }
    }
  };

  const stepNeedsSettings: StepId[] = ["provider-setup", "git", "jira", "automation", "appearance", "defaults"];
  const navigationLocked = saving || runningInstallMode !== null || dismissing;
  const canGoNext = !navigationLocked && (!stepNeedsSettings.includes(active.id) || Boolean(settings));
  const clusterReady = readiness.cluster.status === "ready";
  const dockerExecutionEnabled = settings?.defaults.cliWorkflow.executionMode === "DOCKER";
  const jiraSettings = settings?.integrations.jira || DEFAULT_JIRA_SETTINGS;
  const providerInstanceOptions = enabledProviderInstances.map(([providerConfigId, provider]) => ({
    value: providerConfigId,
    label: getProviderInstanceLabel(provider),
    icon: <ProviderBrandIcon id={provider.provider} />,
  }));
  const workerInstanceOptions = enabledProviderInstances
    .filter(([, provider]) => provider.provider !== "jules")
    .map(([providerConfigId, provider]) => ({
      value: providerConfigId,
      label: getProviderInstanceLabel(provider),
      icon: <ProviderBrandIcon id={provider.provider} />,
    }));
  const stepProgressValue = Math.round(((activeStep + 1) / steps.length) * 100);
  const stepProgressLabel = t("stepProgress", { current: activeStep + 1, total: steps.length, step: active.label });
  const draftAppearance = settings?.defaults.appearance;
  const onboardingBackgroundDark = (() => {
    if (draftAppearance?.theme === "DARK") {
      return true;
    }
    if (draftAppearance?.theme === "LIGHT") {
      return false;
    }
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  })();
  const onboardingBackgroundMode = draftAppearance?.backgroundMode ?? "ANIMATED";
  const onboardingStaticBackgroundColor = draftAppearance?.staticBackgroundColor ?? "#0d0f12";
  const saveStatusText = saving
    ? t("savingSettings")
    : dismissing
      ? t("discardingDraft")
    : error
      ? t("saveFailedAnnouncement")
      : checkingReadiness
        ? t("checkingReadiness")
        : draftDirty
          ? t("draftReadyAnnouncement")
          : t("draftUnchangedAnnouncement");
  const asyncStatusText = runningInstallMode
    ? t("installingMode", { installer: runningInstallMode === "docker-engine-git" ? "Docker Engine" : "Docker Desktop" })
    : installError
      ? t("installationFailedAnnouncement", { message: installError })
      : lastInstallResult
        ? t("installationOutcomeAnnouncement", { status: lastInstallResult.status, message: lastInstallResult.message })
        : t("readinessAnnouncement", { status: readiness.cluster.label, detail: readiness.cluster.detail });
  const closePolicyText = dismissalBlockedMessage
    ?? (draftDirty ? t("closeRequiresConfirmation") : t("closeAvailable"));
  const motionStyle = {
    "--onboarding-enter-exit-duration": interactionTokens.enterExit.duration,
    "--onboarding-enter-exit-ease": interactionTokens.enterExit.ease,
    "--onboarding-selection-duration": interactionTokens.selectionMovement.duration,
    "--onboarding-selection-ease": interactionTokens.selectionMovement.ease,
    "--onboarding-validation-duration": interactionTokens.inlineValidation.duration,
    "--onboarding-validation-ease": interactionTokens.inlineValidation.ease,
    "--onboarding-control-duration": interactionTokens.controlFeedback.duration,
    "--onboarding-control-ease": interactionTokens.controlFeedback.ease,
    "--onboarding-async-duration": interactionTokens.asyncFeedback.duration,
    "--onboarding-async-ease": interactionTokens.asyncFeedback.ease,
  };

  return (
    <>
      {open && introPhase !== "onboarding" && (
        <OnboardingIntro onExitStart={handleIntroExitStart} onComplete={handleIntroComplete} />
      )}
      <Dialog
        isOpen={open && introPhase === "onboarding"}
        onClose={requestClose}
        disableBackdropClick={dismissalBlocked}
        suspendFocusTrap={showDiscardConfirmation}
        ariaLabelledBy="onboarding-title"
        ariaDescribedBy="onboarding-close-policy"
        initialFocusRef={stepHeadingRef}
        className="!z-[200] !h-screen !max-h-none !w-screen !max-w-none !overflow-hidden !rounded-none !border-0 !bg-transparent !shadow-none"
      >
    <div style={motionStyle} className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[#F3F7F5] px-3 py-4 text-slate-900 dark:bg-[#060A0D] dark:text-slate-100 md:px-6 md:py-8">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {onboardingBackgroundMode === "STATIC" ? (
          <div className="absolute inset-0" style={{ backgroundColor: onboardingStaticBackgroundColor }} />
        ) : (
          <Suspense fallback={<div className="absolute inset-0 bg-[#F3F7F5] dark:bg-[#060A0D]" />}>
            <DeepOceanBackground forceDark={onboardingBackgroundDark} className="opacity-75 saturate-[0.86] contrast-[0.92]" />
          </Suspense>
        )}
        <div className="absolute inset-0 bg-white/58 backdrop-blur-[1px] dark:bg-[#05070B]/54" />
        <div className="absolute inset-x-0 top-0 h-56 bg-[linear-gradient(180deg,rgba(0,153,112,0.14),rgba(255,255,255,0.14)_58%,transparent)] dark:bg-[linear-gradient(180deg,rgba(0,224,160,0.12),rgba(5,7,11,0.02)_58%,transparent)]" />
        <div className="absolute inset-x-0 bottom-0 h-72 bg-[linear-gradient(0deg,rgba(226,146,0,0.12),rgba(255,255,255,0.12)_62%,transparent)] dark:bg-[linear-gradient(0deg,rgba(255,184,0,0.08),rgba(5,7,11,0.02)_62%,transparent)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_17%_16%,rgba(0,153,112,0.12),transparent_31%),radial-gradient(circle_at_80%_78%,rgba(226,146,0,0.1),transparent_34%),linear-gradient(115deg,rgba(255,255,255,0.36)_0%,transparent_20%,transparent_72%,rgba(0,153,112,0.08)_100%)] dark:bg-[radial-gradient(circle_at_17%_16%,rgba(0,224,160,0.1),transparent_31%),radial-gradient(circle_at_80%_78%,rgba(255,184,0,0.075),transparent_34%),linear-gradient(115deg,rgba(255,255,255,0.055)_0%,transparent_20%,transparent_72%,rgba(0,224,160,0.05)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(237,242,240,0.48))] dark:bg-[linear-gradient(180deg,rgba(4,7,10,0.18),rgba(4,7,10,0.62))]" />
      </div>
      <section
        ref={shellRef}
        className="relative z-10 grid h-[calc(100vh-2rem)] max-h-[940px] min-h-0 w-full max-w-[1360px] grid-rows-[minmax(0,1fr)] overflow-hidden rounded-[2rem] border border-black/[0.08] bg-[#F9F8F4]/96 shadow-[0_30px_90px_rgba(15,23,42,0.2)] backdrop-blur-2xl dark:border-white/15 dark:bg-void-900/96 dark:shadow-[0_30px_90px_rgba(0,0,0,0.46)] md:h-[calc(100vh-4rem)] md:grid-cols-[330px_1fr]"
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 z-20 rounded-[2rem] ring-1 ring-inset ring-black/[0.06] dark:ring-white/10" />
        <aside ref={sideRef} className="relative hidden h-full min-h-0 overflow-hidden border-r border-black/[0.07] bg-white/82 p-7 text-slate-900 dark:border-white/10 dark:bg-[#0B0F14] dark:text-white md:block">
          <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(0,153,112,0.12),transparent_34%),linear-gradient(330deg,rgba(226,146,0,0.1),transparent_38%)] dark:bg-[linear-gradient(145deg,rgba(0,224,160,0.16),transparent_34%),linear-gradient(330deg,rgba(255,184,0,0.13),transparent_38%)]" />
          <span className="pointer-events-none absolute -left-5 -top-3 select-none font-display text-[8rem] font-black leading-none tracking-tighter text-black/[0.035] dark:text-white/[0.035]">
            RUN
          </span>
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-56 w-56 animate-organic bg-signal-500/[0.08] motion-reduce:animate-none" style={{ borderRadius: "40% 60% 70% 30% / 40% 50% 60% 50%" }} />
            <div className="absolute h-40 w-40 animate-organic-reverse bg-ember-500/[0.12] motion-reduce:animate-none" style={{ borderRadius: "40% 60% 70% 30% / 40% 50% 60% 50%" }} />
            <div className="absolute h-24 w-24 animate-organic bg-signal-500/[0.18] motion-reduce:animate-none" style={{ borderRadius: "40% 60% 70% 30% / 40% 50% 60% 50%" }} />
          </div>
          <div className="absolute inset-x-7 top-24 h-px bg-gradient-to-r from-transparent via-black/10 to-transparent dark:via-white/20" />
          <div className="relative z-10">
            <div data-sidebar-copy className="flex h-12 w-12 items-center justify-center rounded-2xl border border-black/[0.07] bg-white/70 shadow-[0_0_35px_rgba(0,153,112,0.12)] dark:border-white/10 dark:bg-white/10 dark:shadow-[0_0_35px_rgba(0,224,160,0.12)]">
              <Compass className="h-5 w-5 text-signal-700 dark:text-signal-300" />
            </div>
            <div data-sidebar-copy className="mt-8 text-[10px] font-bold uppercase tracking-[0.24em] text-signal-700 dark:text-signal-300">{t("codeUxSetup")}</div>
            <h2 data-sidebar-copy id="onboarding-title" className="mt-3 font-display text-4xl font-semibold leading-[0.95] tracking-tight text-slate-950 dark:text-white">
              {t("makeRuntimeReady")}
            </h2>
            <div className="mt-8 space-y-2">
              {steps.map((step, stepIndex) => {
                const StepIcon = step.icon;
                const activeItem = activeStep === stepIndex;
                const complete = activeStep > stepIndex;
                return (
                  <button
                    key={step.id}
                    data-step-item
                    type="button"
                    aria-current={activeItem ? "step" : undefined}
                    disabled={navigationLocked}
                    onClick={() => setActiveStep(stepIndex)}
                    className={`group flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-[background-color,border-color,transform] hover:translate-x-1 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-x-0 ${
                      activeItem ? "border-signal-500/28 bg-white text-slate-950 shadow-[0_16px_40px_rgba(15,23,42,0.12)] dark:border-white/30 dark:shadow-[0_16px_40px_rgba(0,0,0,0.18)]" : "border-black/0 text-slate-500 hover:border-black/[0.07] hover:bg-black/[0.035] hover:text-slate-900 dark:border-white/0 dark:text-slate-300 dark:hover:border-white/10 dark:hover:bg-white/8 dark:hover:text-white"
                    }`}
                    style={{ transitionDuration: "var(--onboarding-selection-duration)", transitionTimingFunction: "var(--onboarding-selection-ease)" }}
                  >
                    <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${activeItem ? "bg-signal-500/14 text-signal-700" : complete ? "bg-signal-500/12 text-signal-700 dark:bg-signal-400/15 dark:text-signal-300" : "bg-black/[0.04] text-slate-500 dark:bg-white/8 dark:text-slate-300"}`}>
                      {complete ? <Check className="h-4 w-4" /> : <StepIcon className="h-4 w-4" />}
                    </span>
                    <span className="text-sm font-bold">{step.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <div className="relative flex h-full max-h-full min-h-0 flex-col overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_4%,rgba(0,224,160,0.08),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.38),rgba(255,255,255,0.08)_34%,rgba(255,255,255,0))] dark:bg-[radial-gradient(circle_at_78%_4%,rgba(0,224,160,0.08),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015)_34%,rgba(255,255,255,0))]" />
          <header className="relative flex shrink-0 items-center justify-between gap-4 border-b border-black/[0.06] px-5 py-4 dark:border-white/[0.06] md:px-8">
            <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-signal-500/30 to-transparent" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                {t("stepCount", { current: activeStep + 1, total: steps.length })}
              </div>
              <h3 ref={stepHeadingRef} tabIndex={-1} className="mt-1 font-display text-xl font-semibold tracking-tight text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 dark:text-white">{active.label}</h3>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.08]" role="progressbar" aria-label={stepProgressLabel} aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={activeStep + 1}>
                <div
                  className="h-full rounded-full bg-signal-500 transition-[width] motion-reduce:transition-none"
                  style={{ width: `${stepProgressValue}%`, transitionDuration: "var(--onboarding-selection-duration)", transitionTimingFunction: "var(--onboarding-selection-ease)" }}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <p
                id="onboarding-close-policy"
                role={dismissalBlockedMessage || dismissalNotice ? "status" : undefined}
                aria-live={dismissalBlockedMessage || dismissalNotice ? "polite" : undefined}
                className={dismissalBlockedMessage || dismissalNotice ? "max-w-64 text-right text-xs font-semibold leading-relaxed text-status-amber" : "sr-only"}
              >
                {dismissalNotice ?? closePolicyText}
              </p>
              <button
                type="button"
                onClick={requestClose}
                disabled={dismissalBlocked}
                aria-describedby="onboarding-close-policy"
                className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-black/[0.05] hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 disabled:cursor-not-allowed disabled:opacity-45 dark:hover:bg-white/[0.06] dark:hover:text-white"
                aria-label={t("closeOnboarding")}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </header>

          <div ref={contentRef} className="dashboard-scrollbar relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 dark:text-slate-100 md:px-8">
            <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{stepProgressLabel}. {saveStatusText}. {asyncStatusText}</div>
            {error ? (
              <div className="mb-4 rounded-2xl border border-status-red/20 bg-status-red/10 px-4 py-3 text-sm font-semibold text-status-red" role="alert">
                <div>{error}</div>
                <button type="button" onClick={() => void applyAndClose()} className="mt-3 rounded-xl border border-status-red/30 px-3 py-1.5 text-xs font-black uppercase tracking-[0.12em]">
                  {t("retrySave")}
                </button>
              </div>
            ) : null}
            {validationMessage ? (
              <div
                ref={validationRef}
                tabIndex={-1}
                role="alert"
                className="mb-4 rounded-2xl border border-status-red/25 bg-status-red/10 px-4 py-3 text-sm font-semibold text-status-red outline-none transition-[border-color,background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-status-red/40"
                style={{ transitionDuration: "var(--onboarding-validation-duration)", transitionTimingFunction: "var(--onboarding-validation-ease)" }}
              >
                {validationMessage}
              </div>
            ) : null}

            {active.id === "mode" ? (
              <div className="space-y-4">
                <div data-onboarding-card className="relative overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/80 p-6 shadow-[0_18px_48px_rgba(15,23,42,0.055)] dark:border-white/[0.06] dark:bg-white/[0.045]">
                  <div aria-hidden className="absolute -right-8 -top-10 font-display text-[7rem] font-black leading-none tracking-tight text-black/[0.025] dark:text-white/[0.025]">UX</div>
                  <div className="relative z-10 max-w-3xl">
                    <div className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-signal-700 dark:text-signal-200">
                      <Compass className="h-3.5 w-3.5" strokeWidth={2.4} />
                      {t("chooseSetupPath")}
                    </div>
                    <h4 className="mt-4 font-display text-2xl font-semibold leading-none tracking-tight text-slate-950 dark:text-white">
                      {t("setupControlTitle")}
                    </h4>
                    <p className="mt-3 text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300">
                      {t("setupControlBody")}
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label={t("setupModeLabel")}>
                  {dashboardExperienceModeOptions.map((option) => {
                    const selected = experienceMode === option.value;
                    return (
                      <button
                        key={option.value}
                        data-onboarding-card
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={!settings}
                        onClick={() => applyExperienceMode(option.value)}
                        className={`group relative overflow-hidden rounded-[1.5rem] border p-5 text-left shadow-[0_14px_34px_rgba(15,23,42,0.04)] transition-[border-color,background-color,transform,box-shadow] hover:-translate-y-1 disabled:cursor-wait disabled:opacity-60 ${
                          selected
                            ? "border-signal-500/30 bg-signal-500/10 shadow-[0_18px_46px_rgba(0,224,160,0.08)]"
                            : "border-black/[0.06] bg-white/75 hover:border-black/[0.12] dark:border-white/[0.06] dark:bg-white/[0.04]"
                        }`}
                        style={{ transitionDuration: "var(--onboarding-selection-duration)", transitionTimingFunction: "var(--onboarding-selection-ease)" }}
                      >
                        <div aria-hidden className={`absolute left-0 top-5 bottom-5 w-1 rounded-r-full transition-opacity ${selected ? "bg-signal-500 opacity-100" : "bg-slate-300 opacity-0 group-hover:opacity-100 dark:bg-slate-600"}`} />
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-base font-black text-slate-900 dark:text-white">{t(option.value === "EASY" ? "modeEasy" : option.value === "STANDARD" ? "modeStandard" : "modeExpert")}</div>
                          {selected ? <Check className="h-5 w-5 text-signal-600 dark:text-signal-300" /> : <ChevronRight className="h-5 w-5 text-slate-300 dark:text-slate-600" />}
                        </div>
                        <div className="mt-3 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{t(option.value === "EASY" ? "modeEasyDescription" : option.value === "STANDARD" ? "modeStandardDescription" : "modeExpertDescription")}</div>
                        {option.value === "EASY" ? (
                          <div className="mt-4 rounded-2xl border border-signal-500/15 bg-signal-500/[0.07] px-3 py-2 text-xs font-semibold leading-relaxed text-signal-800 dark:text-signal-200">
                            {t("easyFlowSummary")}
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {active.id === "installation" ? (
              <OnboardingInstallationStep
                clusterReady={clusterReady}
                readiness={readiness}
                osInfo={getOSInfo(platform)}
                selectedInstallMode={runningInstallMode ?? lastInstallResult?.mode ?? null}
                runningInstallMode={runningInstallMode}
                lastInstallResult={lastInstallResult}
                failedInstallMode={failedInstallMode}
                installError={installError}
                checkingReadiness={checkingReadiness}
                onAutoInstall={handleAutoInstall}
                onInstallMode={(mode) => void runDependencyInstall(mode)}
                onRecheck={() => void load()}
              />
            ) : null}

            {active.id === "introduction" ? (
              <div className="space-y-4">
                <div data-onboarding-card className="relative overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/80 p-6 shadow-[0_18px_48px_rgba(15,23,42,0.055)] dark:border-white/[0.06] dark:bg-white/[0.045]">
                  <div aria-hidden className="absolute -right-8 -top-10 font-display text-[7rem] font-black leading-none tracking-tight text-black/[0.025] dark:text-white/[0.025]">UX</div>
                  <div className="relative z-10 max-w-3xl">
                    <div className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-signal-700 dark:text-signal-200">
                      <Sparkles className="h-3.5 w-3.5" strokeWidth={2.4} />
                      {t("agenticRuntime")}
                    </div>
                    <h4 className="mt-4 font-display text-2xl font-semibold leading-none tracking-tight text-slate-950 dark:text-white">{t("welcomeCodeUx")}</h4>
                    <p className="mt-3 text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300">
                      {t("introductionBody")}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2">
                      {[
                        [Github, t("github"), CODEUX_REPO_URL],
                        [Star, t("starOnGithub"), CODEUX_REPO_URL],
                        [BookOpen, t("documentation"), `${CODEUX_REPO_URL}#readme`],
                      ].map(([Icon, label, href]) => {
                        const BadgeIcon = Icon as typeof Github;
                        return (
                          <a
                            key={String(label)}
                            href={getSafeUrl(String(href))}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-2xl border border-black/[0.06] bg-white/80 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-600 shadow-[0_10px_24px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:border-signal-500/25 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 dark:border-white/[0.08] dark:bg-white/[0.055] dark:text-slate-300 dark:hover:text-white"
                          >
                            <BadgeIcon className="h-3.5 w-3.5 text-signal-600 dark:text-signal-300" strokeWidth={2.4} />
                            {String(label)}
                          </a>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {[
                    [t("containerFirstTitle"), t("containerFirstBody"), ShieldCheck],
                    [t("credentialBoundaryTitle"), t("credentialBoundaryBody"), ShieldCheck],
                    [t("tosWorkflowTitle"), t("tosWorkflowBody"), ShieldCheck],
                    [t("knowledgeBaseTitle"), t("knowledgeBaseBody"), Library],
                  ].map(([title, description, Icon]) => {
                    const CardIcon = Icon as typeof ShieldCheck;
                    return (
                      <div data-onboarding-card key={title as string} className="group rounded-3xl border border-black/[0.06] bg-white/75 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.045)] transition-transform hover:-translate-y-1 dark:border-white/[0.06] dark:bg-white/[0.04]">
                        <CardIcon className="h-6 w-6 text-signal-600 dark:text-signal-300" />
                        <div className="mt-4 text-base font-black text-slate-900 dark:text-white">{title as string}</div>
                        <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{description as string}</div>
                      </div>
                    );
                  })}
                </div>
                <div data-onboarding-card className="relative overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/80 p-6 shadow-[0_18px_48px_rgba(15,23,42,0.055)] dark:border-white/[0.06] dark:bg-white/[0.045]">
                  <div aria-hidden className="absolute -right-8 -top-10 font-display text-[7rem] font-black leading-none tracking-tight text-black/[0.025] dark:text-white/[0.025]">MIT</div>
                  <div className="relative z-10">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-signal-600 dark:text-signal-300" strokeWidth={2.4} />
                        <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-700 dark:text-slate-200">{t("license")}</div>
                      </div>
                      <a
                        href={getSafeUrl(`${CODEUX_REPO_URL}/blob/main/LICENSE`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] font-black uppercase tracking-[0.14em] text-signal-600 hover:text-signal-700 dark:text-signal-300 dark:hover:text-signal-200"
                      >
                        {t("viewOnGithub")}
                      </a>
                    </div>
                    <p className="mt-2 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                      {t("licenseExplanation")}
                    </p>
                    <div className="dashboard-scrollbar mt-4 max-h-52 overflow-y-auto overscroll-contain rounded-[1.25rem] border border-black/[0.06] bg-black/[0.03] p-4 dark:border-white/[0.06] dark:bg-white/[0.04]">
                      <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">{LICENSE_TEXT}</pre>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {active.id === "providers" ? (
              <div className="space-y-4">
                <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
                  <div className="flex items-start gap-3">
                    <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-signal-600 dark:text-signal-300" />
                    <div>
                      <div className="text-base font-black text-slate-900 dark:text-white">{t("chooseProvidersTitle")}</div>
                      <div className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                        {t("chooseProvidersBody")}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {PROVIDER_TYPES.map((providerId) => {
                    const provider = readinessByProvider[providerId];
                    const selected = selectedProviders.includes(providerId);
                    const instanceCount = getSystemProvidersByType(settings, providerId).length;
                    return (
                      <button
                        data-onboarding-card
	                        key={providerId}
	                        type="button"
	                        aria-pressed={selected}
	                        aria-label={t(selected ? "deselectProvider" : "selectProvider", { provider: providerLabels[providerId] })}
	                        onClick={() => toggleProvider(providerId)}
	                        className={`group relative overflow-hidden rounded-3xl border p-4 text-left shadow-[0_14px_34px_rgba(15,23,42,0.04)] transition-[border-color,background-color,transform,box-shadow] hover:-translate-y-1 ${selected ? "border-signal-500/30 bg-signal-500/10 shadow-[0_18px_46px_rgba(0,224,160,0.08)]" : "border-black/[0.06] bg-white/75 hover:border-black/[0.12] dark:border-white/[0.06] dark:bg-white/[0.04]"}`}
	                        style={{ transitionDuration: "var(--onboarding-selection-duration)", transitionTimingFunction: "var(--onboarding-selection-ease)" }}
	                      >
                        <div aria-hidden className={`absolute left-0 top-4 bottom-4 w-1 rounded-r-full transition-opacity ${selected ? "bg-signal-500 opacity-100" : "bg-slate-300 opacity-0 group-hover:opacity-100 dark:bg-slate-600"}`} />
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <ProviderBrandIcon id={providerId} />
                            <div>
                              <div className="font-black text-slate-900 dark:text-white">{providerLabels[providerId]}</div>
                              <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{tp("instanceCount", instanceCount || 1)}</div>
                            </div>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] ${isDeprecatedProvider(providerId) ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : provider?.available ? "bg-signal-500/10 text-signal-700 dark:text-signal-300" : selected ? "bg-ember-500/10 text-ember-600 dark:text-ember-400" : "bg-slate-500/10 text-slate-500"}`}>
                            {isDeprecatedProvider(providerId) ? t("deprecated") : providerId === "jules" ? t("apiKey") : provider?.available ? t("detected") : selected ? t("configure") : t("optional")}
                          </span>
                        </div>
                        <div className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{provider?.description || localizedProviderDescriptions[providerId]}</div>
                        {isDeprecatedProvider(providerId) ? (
                          <div className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">{t("geminiDeprecated")}</div>
                        ) : null}
                        {selected && toolStatusByProvider[providerId] ? (
                          <div className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-300">{toolStatusByProvider[providerId]?.stepText}</div>
                        ) : null}
                        <div className="mt-3 font-mono text-[11px] text-slate-400">{provider?.authPath || (providerId === "jules" ? t("apiKeyOnly") : t("authPathConfigurable"))}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {active.id === "provider-setup" ? (
              isEasyMode ? (
                <div className="space-y-4">
                  <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
                    <div className="flex items-start gap-3">
                      <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-signal-600 dark:text-signal-300" />
                      <div>
                        <div className="text-base font-black text-slate-900 dark:text-white">{t("chooseProviderLogin")}</div>
                        <div className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                          {t("chooseProviderLoginBody")}
                        </div>
                      </div>
                    </div>
                  </div>
                  {settings ? (
                    <div className="grid gap-4 lg:grid-cols-2" role="radiogroup" aria-label={t("primaryProvider")}>
                      {EASY_PROVIDER_TYPES.map((providerId) => {
                        const existingEntry = getSystemProvidersByType(settings, providerId)[0];
                        const providerConfigId = existingEntry?.[0] ?? providerId;
                        const integrationProvider = existingEntry?.[1] ?? createEasyDashboardProviderDraft(providerId, providerConfigId);
                        const authMode = easyProviderAuthModes[providerId] ?? "dashboardAuth";
                        return (
                          <EasyProviderAuthCard
                            key={providerId}
                            providerConfigId={providerConfigId}
                            provider={integrationProvider}
                            authMode={authMode}
                            selected={easySelectedProvider === providerId}
                            readinessStatus={readinessByProvider[providerId]}
                            toolStatus={toolStatusByProvider[providerId]}
                            onSelect={() => configureEasyProviderInstance(
                              providerId,
                              providerConfigId,
                              getEasyAuthUpdates(providerConfigId, providerId, authMode, integrationProvider.authPath),
                            )}
                            onAuthModeChange={(nextAuthMode) => {
                              setEasyProviderAuthModes((current) => ({ ...current, [providerId]: nextAuthMode }));
                              configureEasyProviderInstance(
                                providerId,
                                providerConfigId,
                                getEasyAuthUpdates(providerConfigId, providerId, nextAuthMode, integrationProvider.authPath),
                              );
                            }}
                            onUpdate={(updates) => configureEasyProviderInstance(providerId, providerConfigId, updates)}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/75 p-6 text-sm text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04]">
                      {t("loadingProviderSettings")}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                {selectedProviderTypes.length === 0 ? (
                  <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/75 p-6 text-sm text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04]">
                    {t("noProvidersSelected")}
                  </div>
                ) : selectedProviderTypes.map((providerId) => {
                  const providerEntries = getSystemProvidersByType(settings, providerId);
                  const readinessStatus = readinessByProvider[providerId];
                  return (
                    <div data-onboarding-card key={providerId} className="relative overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/78 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.055)] dark:border-white/[0.06] dark:bg-white/[0.04]">
                      <div aria-hidden className="pointer-events-none absolute -right-6 -top-8 font-display text-[7rem] font-black leading-none tracking-tight text-black/[0.025] dark:text-white/[0.025]">
                        {getProviderWatermark(providerId)}
                      </div>
                      <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.06] pb-4 dark:border-white/[0.06]">
                        <div className="flex min-w-0 items-start gap-3">
                          <ProviderBrandIcon id={providerId} />
                          <div className="min-w-0">
                            <div className="text-base font-black text-slate-900 dark:text-white">{providerLabels[providerId]}</div>
                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {readinessStatus?.detectedFiles.length ? t("detectedFiles", { files: readinessStatus.detectedFiles.join(", ") }) : localizedProviderDescriptions[providerId]}
                            </div>
                          </div>
                        </div>
	                        <button
	                          type="button"
	                          aria-label={t("addProviderInstance", { provider: providerLabels[providerId] })}
	                          onClick={() => addProviderInstance(providerId)}
	                          className="inline-flex items-center gap-2 rounded-2xl border border-signal-500/20 bg-signal-500/10 px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-signal-700 hover:bg-signal-500/15 dark:text-signal-200"
	                          style={{ transitionDuration: "var(--onboarding-control-duration)", transitionTimingFunction: "var(--onboarding-control-ease)" }}
	                        >
                          <Plus className="h-3.5 w-3.5" />
                          {t("addInstance")}
                        </button>
                      </div>

                      <div className="relative z-10 mt-4 space-y-3">
                        {providerEntries.length === 0 ? (
                          <div className="rounded-2xl border border-ember-500/20 bg-ember-500/10 p-4 text-sm text-ember-700 dark:text-ember-300">
                            {t("addInstanceCredentials", { provider: providerLabels[providerId] })}
                          </div>
                        ) : providerEntries.map(([providerConfigId, integrationProvider], index) => {
                          const projectProvider = settings?.defaults.aiProvider.providers[providerConfigId];
                          const providerModel = projectProvider?.model
                            || (integrationProvider.provider === "opencode" ? "anthropic/claude-sonnet-4-5" : "qwen3-coder-plus");
                          return (
                            <ProviderInstanceCard
                              key={providerConfigId}
                              providerConfigId={providerConfigId}
                              provider={integrationProvider}
                              providerModel={providerModel}
                              dockerExecutionEnabled={dockerExecutionEnabled}
                              onUpdate={(updates) => configureProviderInstance(providerConfigId, updates)}
                              onRemove={providerEntries.length > 1 ? () => removeProviderInstance(providerConfigId) : undefined}
                              enabled={projectProvider?.enabled ?? true}
                              onToggleEnabled={(value) => configureProjectProvider(providerConfigId, { enabled: value })}
                              index={index}
                              total={providerEntries.length}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              )
            ) : null}

            {active.id === "git" && settings ? (
              isEasyMode ? (
                <div className="space-y-4">
                  <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
                    <div className="flex items-start gap-3">
                      <Github className="mt-0.5 h-5 w-5 shrink-0 text-signal-600 dark:text-signal-300" />
                      <div>
                        <div className="text-base font-black text-slate-900 dark:text-white">{t("gitHubWorkflow")}</div>
                        <div className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                          {t("easyGitBody")}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div data-onboarding-card className="space-y-3 rounded-[2rem] border border-black/[0.06] bg-white/80 p-6 shadow-[0_18px_48px_rgba(15,23,42,0.055)] dark:border-white/[0.06] dark:bg-white/[0.045]">
                    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-black/[0.06] bg-white/75 p-4 text-left shadow-[0_12px_28px_rgba(15,23,42,0.035)] transition-colors hover:border-signal-500/20 dark:border-white/[0.06] dark:bg-white/[0.04]">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-signal-600 focus:ring-2 focus:ring-signal-500"
                        checked={easyUseGithub}
                        onChange={(event) => applyExperienceMode("EASY", {
                          useGithub: event.currentTarget.checked,
                          manageGithubPrWorkflow: event.currentTarget.checked ? easyManageGithubPrWorkflow : false,
                        })}
                      />
                      <span>
                        <span className="block text-sm font-bold text-slate-900 dark:text-white">{t("useGithubWorkspace")}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                          {t("useGithubBody")}
                        </span>
                      </span>
                    </label>
                    <label className={`flex items-start gap-3 rounded-2xl border border-black/[0.06] bg-white/75 p-4 text-left shadow-[0_12px_28px_rgba(15,23,42,0.035)] transition-colors dark:border-white/[0.06] dark:bg-white/[0.04] ${easyUseGithub ? "cursor-pointer hover:border-signal-500/20" : "cursor-not-allowed opacity-60"}`}>
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-signal-600 focus:ring-2 focus:ring-signal-500 disabled:cursor-not-allowed"
                        checked={easyUseGithub && easyManageGithubPrWorkflow}
                        disabled={!easyUseGithub}
                        onChange={(event) => applyExperienceMode("EASY", {
                          useGithub: easyUseGithub,
                          manageGithubPrWorkflow: event.currentTarget.checked,
                        })}
                      />
                      <span>
                        <span className="block text-sm font-bold text-slate-900 dark:text-white">{t("manageGithubDefaults")}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                          {t("manageGithubDefaultsBody")}
                        </span>
                      </span>
                    </label>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
                  <div className="flex items-start gap-3">
                    <GitBranch className="mt-0.5 h-5 w-5 shrink-0 text-signal-600 dark:text-signal-300" />
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-black text-slate-900 dark:text-white">{t("gitMode")}</div>
                      <div className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                        {t("gitModeBody")}
                      </div>
                      <div className="mt-4">
                        <PillChoiceGroup
                          value={gitMode}
                          onChange={(value) => updateCliWorkflow({ gitMode: value as ProjectSettings["cliWorkflow"]["gitMode"] })}
                          options={[
                            { value: "remote", label: t("remote"), hint: t("remoteHint") },
                            { value: "local", label: t("local"), hint: t("localHint") },
                          ]}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                {gitMode === "local" ? (
                  <div data-onboarding-card className="flex items-start gap-3 rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
                    <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-500 dark:text-amber-300" />
                    <div className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                      {t("localModeWarning")}
                    </div>
                  </div>
                ) : null}
                {gitMode !== "local" ? (
                  <>
                    <div data-onboarding-card>
                      <SectionCard title={t("github")} watermark="GIT" icon={<Github strokeWidth={2.4} />}>
                        <Row label={t("githubToken")} description={t("githubTokenBody")}>
	                          <TextInput
	                            aria-label={t("githubToken")}
	                            value={settings.integrations.githubToken || ""}
                            onChange={(value) => updateSettings((current) => ({ ...current, integrations: { ...current.integrations, githubToken: value } }))}
                            mono
                          />
                        </Row>
                        <Row label={t("mountGithubAuth")} description={t("mountGithubAuthBody")}>
	                          <Toggle aria-label={t("mountGithubAuth")}                             value={settings.defaults.cliWorkflow.containerMountGithubAuth}
                            onChange={() => updateCliWorkflow({ containerMountGithubAuth: !settings.defaults.cliWorkflow.containerMountGithubAuth })}
                          />
                        </Row>
                        <Row label={t("githubAuthPath")} description={t("githubAuthPathBody")} last>
	                          <TextInput
	                            aria-label={t("githubAuthPath")}
	                            value={settings.defaults.cliWorkflow.containerGithubAuthPath}
                            onChange={(value) => updateCliWorkflow({ containerGithubAuthPath: value })}
                            disabled={!settings.defaults.cliWorkflow.containerMountGithubAuth}
                            mono
                          />
                        </Row>
                      </SectionCard>
                    </div>
                    <div data-onboarding-card>
                      <SectionCard title={t("gitlab")} watermark="GLB" icon={<GitBranch strokeWidth={2.4} />}>
                        <Row label={t("gitlabToken")} description={t("gitlabTokenBody")} last>
	                          <TextInput
	                            aria-label={t("gitlabToken")}
	                            value={settings.integrations.gitlabToken || ""}
                            onChange={(value) => updateSettings((current) => ({ ...current, integrations: { ...current.integrations, gitlabToken: value } }))}
                            mono
                          />
                        </Row>
                      </SectionCard>
                    </div>
                  </>
                ) : null}
                <div data-onboarding-card>
                  <SectionCard title={t("gitIdentity")} watermark="ID" icon={<GitBranch strokeWidth={2.4} />}>
                    <Row label={t("copyGitConfig")} description={t("copyGitConfigBody")} last={settings.defaults.cliWorkflow.containerMountGitConfig}>
	                      <Toggle aria-label={t("copyGitConfig")}                         value={settings.defaults.cliWorkflow.containerMountGitConfig}
                        onChange={() => updateCliWorkflow({ containerMountGitConfig: !settings.defaults.cliWorkflow.containerMountGitConfig })}
                      />
                    </Row>
                    {!settings.defaults.cliWorkflow.containerMountGitConfig ? (
                      <>
                        <Row label={t("gitUserName")} description={t("gitUserNameBody")}>
	                          <TextInput
	                            aria-label={t("gitUserName")}
	                            value={settings.defaults.cliWorkflow.containerGitUserName}
                            onChange={(value) => updateCliWorkflow({ containerGitUserName: value })}
                            placeholder="Code UX"
                          />
                        </Row>
                        <Row label={t("gitEmail")} description={t("gitEmailBody")} last>
	                          <TextInput
	                            aria-label={t("gitEmail")}
	                            value={settings.defaults.cliWorkflow.containerGitUserEmail}
                            onChange={(value) => updateCliWorkflow({ containerGitUserEmail: value })}
                            placeholder="agents@codeux.ai"
                            mono
                          />
                        </Row>
                      </>
                    ) : null}
                  </SectionCard>
                </div>
              </div>
              )
            ) : null}

            {active.id === "jira" && settings ? (
              <div className="space-y-4">
                <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#0052CC]/18 bg-[#0052CC]/10 text-[#0052CC] dark:border-[#4C9AFF]/18 dark:bg-[#4C9AFF]/10 dark:text-[#4C9AFF]">
                      <JiraIcon className="h-5 w-5" />
                    </span>
                    <div>
                      <div className="text-base font-black text-slate-900 dark:text-white">{t("connectJira")}</div>
                      <div className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                        {t("jiraBody")}
                      </div>
                    </div>
                  </div>
                </div>
                <div data-onboarding-card>
                  <SectionCard title={t("jiraConfiguration")} watermark="JRA" icon={<ClipboardList strokeWidth={2.4} />}>
                    <Row label={t("jiraSiteUrl")} description={t("jiraSiteUrlBody")}>
                      <TextInput aria-label={t("jiraSiteUrl")} value={jiraSettings.host} onChange={(value) => updateJira({ host: value })} mono />
                    </Row>
                    <Row label={t("accountEmail")} description={t("jiraAccountEmailBody")}>
                      <TextInput aria-label={t("jiraAccountEmail")} value={jiraSettings.email} onChange={(value) => updateJira({ email: value })} mono />
                    </Row>
                    <Row label={t("apiToken")} description={t("jiraApiTokenBody")}>
                      <TextInput aria-label={t("jiraApiToken")} value={jiraSettings.apiToken} onChange={(value) => updateJira({ apiToken: value })} mono />
                    </Row>
                    <Row label={t("defaultProject")} description={t("defaultProjectBody")}>
                      <TextInput aria-label={t("jiraDefaultProject")} value={jiraSettings.defaultProject} onChange={(value) => updateJira({ defaultProject: value.toUpperCase() })} mono />
                    </Row>
                    <Row label={t("closeTransition")} description={t("closeTransitionBody")}>
                      <TextInput aria-label={t("jiraCloseTransition")} value={jiraSettings.closeTransitionName} onChange={(value) => updateJira({ closeTransitionName: value })} />
                    </Row>
                    <Row label={t("autoCloseJira")} description={t("autoCloseJiraBody")} last>
	                      <Toggle aria-label={t("autoCloseJira")} value={jiraSettings.autoCloseLinkedIssues} onChange={() => updateJira({ autoCloseLinkedIssues: !jiraSettings.autoCloseLinkedIssues })} />
                    </Row>
                  </SectionCard>
                </div>
              </div>
            ) : null}

            {active.id === "automation" && settings ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Choice title={t("automationLevel")} value={settings.defaults.automationLevel} options={[
                  ["ALWAYS_ASK", t("manual")],
                  ["SEMI_AUTO", t("semiAuto")],
                  ["FULL", t("fullAuto")],
                ]} onChange={(value) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, automationLevel: value as SystemSettings["defaults"]["automationLevel"] } }))} />
                <Choice title={t("featurePrAutomerge")} value={settings.defaults.ciIntelligence.featurePrAutoMergeMode} options={[
                  ["OFF", t("off")],
                  ["CREATE_PR", t("createPr")],
                  ["WHEN_GREEN", t("whenGreen")],
                  ["ALWAYS", t("always")],
                ]} onChange={(value) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, ciIntelligence: { ...current.defaults.ciIntelligence, featurePrAutoMergeMode: value as SystemSettings["defaults"]["ciIntelligence"]["featurePrAutoMergeMode"] } } }))} />
                <Choice title={t("mainPrAutomerge")} value={settings.defaults.ciIntelligence.mainBranchAutoMergeMode} options={[
                  ["OFF", t("off")],
                  ["CREATE_PR", t("createPr")],
                  ["WHEN_GREEN", t("whenGreen")],
                  ["ALWAYS", t("always")],
                ]} onChange={(value) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, ciIntelligence: { ...current.defaults.ciIntelligence, mainBranchAutoMergeMode: value as SystemSettings["defaults"]["ciIntelligence"]["mainBranchAutoMergeMode"] } } }))} />
                <ToggleRow title={t("autoApprovePlans")} description={t("autoApprovePlansBody")} checked={settings.defaults.automationInterventions.autoApprovePlan} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, automationInterventions: { ...current.defaults.automationInterventions, autoApprovePlan: checked } } }))} />
                <ToggleRow title={t("memorySystem")} description={t("memorySystemBody")} checked={settings.defaults.memory.enabled} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, memory: { ...current.defaults.memory, enabled: checked } } }))} />
                <ToggleRow title={t("resolveMainConflicts")} description={t("resolveMainConflictsBody")} checked={settings.defaults.ciIntelligence.resolveMainMergeConflicts} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, ciIntelligence: { ...current.defaults.ciIntelligence, resolveMainMergeConflicts: checked } } }))} />
                <ToggleRow title={t("fixMainCi")} description={t("fixMainCiBody")} checked={settings.defaults.ciIntelligence.resolveMainMergeFailedChecks} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, ciIntelligence: { ...current.defaults.ciIntelligence, resolveMainMergeFailedChecks: checked } } }))} />
                <ToggleRow title={t("resolveFeatureConflicts")} description={t("resolveFeatureConflictsBody")} checked={settings.defaults.ciIntelligence.resolveMergeConflicts} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, ciIntelligence: { ...current.defaults.ciIntelligence, resolveMergeConflicts: checked } } }))} />
                <ToggleRow title={t("enableQaAgent")} description={t("enableQaAgentBody")} checked={settings.defaults.agents.qualityAssurance.enabled} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, agents: { ...current.defaults.agents, qualityAssurance: { ...current.defaults.agents.qualityAssurance, enabled: checked } } } }))} />
              </div>
            ) : null}

            {active.id === "appearance" && settings ? (
              <OnboardingAppearanceStep settings={settings} updateAppearance={updateAppearance} />
            ) : null}

            {active.id === "defaults" && settings ? (
              <div className="space-y-4">
                <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
                  <div className="flex items-start gap-3">
                    <Layers className="mt-0.5 h-5 w-5 shrink-0 text-signal-600 dark:text-signal-300" />
                    <div>
                      <div className="text-base font-black text-slate-900 dark:text-white">{t("pickDefaultProviders")}</div>
                      <div className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                        {t("pickDefaultProvidersBody")}
                      </div>
                    </div>
                  </div>
                </div>
                {enabledProviderInstances.length === 0 ? (
                  <div data-onboarding-card className="rounded-3xl border border-ember-500/20 bg-ember-500/10 p-6 text-sm text-ember-700 dark:text-ember-300">
                    {t("noEnabledProviders")}
                  </div>
                ) : (
                  <>
                    <div data-onboarding-card>
                      <SectionCard title={t("defaultRouting")} watermark="DEF" icon={<Layers strokeWidth={2.4} />}>
                        <Row label={t("defaultAiProvider")} description={t("defaultAiProviderBody")}>
                          <SelectInput
                            value={settings.defaults.aiProvider.provider || ""}
                            onChange={(value) => updateSettings((current) => ({
                              ...current,
                              defaults: {
                                ...current.defaults,
                                aiProvider: { ...current.defaults.aiProvider, provider: value as ProviderConfigId },
                              },
                            }))}
                            options={providerInstanceOptions}
                            aria-label={t("defaultAiProvider")}
                          />
                        </Row>
                        <Row label={t("virtualWorkerProvider")} description={t("virtualWorkerProviderBody")} last>
                          <SelectInput
                            value={settings.defaults.workers.virtualWorkerProvider || ""}
                            onChange={(value) => updateSettings((current) => ({
                              ...current,
                              defaults: {
                                ...current.defaults,
                                workers: { ...current.defaults.workers, virtualWorkerProvider: value as ProviderConfigId },
                              },
                            }))}
                            options={workerInstanceOptions.length > 0 ? workerInstanceOptions : providerInstanceOptions}
                            aria-label={t("virtualWorkerProvider")}
                          />
                        </Row>
                      </SectionCard>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {enabledProviderInstances.map(([providerConfigId, provider]) => {
                        const isDefault = settings.defaults.aiProvider.provider === providerConfigId;
                        const isWorker = settings.defaults.workers.virtualWorkerProvider === providerConfigId;
                        return (
                          <div data-onboarding-card key={providerConfigId} className="flex items-center justify-between gap-3 rounded-3xl border border-black/[0.06] bg-white/75 p-4 shadow-[0_14px_34px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
                            <div className="flex min-w-0 items-center gap-3">
                              <ProviderBrandIcon id={provider.provider} />
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{provider.name}</div>
                                <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{getProviderTypeLabel(provider.provider)}</div>
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                              {isDefault ? (
                                <span className="rounded-full border border-signal-500/25 bg-signal-500/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-signal-700 dark:text-signal-200">{t("defaultBadge")}</span>
                              ) : null}
                              {isWorker ? (
                                <span className="rounded-full border border-sky-500/25 bg-sky-500/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-sky-700 dark:text-sky-300">{t("workerBadge")}</span>
                              ) : null}
                              {!isDefault && !isWorker ? (
                                <span className="rounded-full border border-black/[0.08] bg-black/[0.03] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.04]">{t("availableBadge")}</span>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>

          <footer className="relative flex shrink-0 items-center justify-between gap-3 border-t border-black/[0.06] bg-white/45 px-5 py-4 backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-950/28 md:px-8">
            <button
              type="button"
              disabled={activeStep === 0 || navigationLocked}
              onClick={goToPreviousStep}
              className="inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-bold text-slate-500 transition-colors hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.06]"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("back")}
            </button>
            <div id="onboarding-status" role="status" aria-live="polite" className="hidden min-w-0 flex-1 truncate text-center text-xs font-semibold text-slate-500 dark:text-slate-400 sm:block">
              {saveStatusText}
            </div>
            <div className="flex items-center gap-2" aria-label={t("stepShortcuts")}>
              {steps.map((dot, idx) => (
	                <button
	                  key={`dot-${idx}`}
	                  type="button"
	                  aria-label={t("goToStep", { step: dot.label })}
	                  disabled={navigationLocked}
	                  onClick={() => setActiveStep(idx)}
	                  className={`h-2 rounded-full transition-all motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 disabled:cursor-not-allowed disabled:opacity-50 ${activeStep === idx ? "w-8 bg-signal-500" : "w-2 bg-slate-300 dark:bg-slate-700"}`}
	                  style={{ transitionDuration: "var(--onboarding-selection-duration)", transitionTimingFunction: "var(--onboarding-selection-ease)" }}
	                />
              ))}
            </div>
            {activeStep === steps.length - 1 ? (
              <button
                type="button"
                onClick={() => void applyAndClose()}
                disabled={navigationLocked}
                aria-describedby="onboarding-status"
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white shadow-[0_12px_28px_rgba(15,23,42,0.18)] transition-colors hover:bg-slate-700 disabled:opacity-60 dark:bg-white dark:text-void-900"
              >
	                {saving ? <RefreshCw className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Check className="h-4 w-4" />}
                {saving ? t("saving") : t("finish")}
              </button>
            ) : (
              <button
                type="button"
                disabled={!canGoNext}
                onClick={handleContinue}
                aria-describedby="onboarding-status"
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white shadow-[0_12px_28px_rgba(15,23,42,0.18)] transition-colors hover:bg-slate-700 disabled:opacity-60 dark:bg-white dark:text-void-900"
              >
                {t("next")}
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </footer>
        </div>
      </section>
    </div>
      </Dialog>
      <Dialog
        isOpen={open && showDiscardConfirmation}
        onClose={() => setShowDiscardConfirmation(false)}
        disableBackdropClick={dismissing}
        ariaLabelledBy="onboarding-discard-title"
        ariaDescribedBy="onboarding-discard-description"
        className="!z-[220] w-[calc(100vw-2rem)] max-w-md !overflow-hidden"
      >
        <div className="p-6">
          <h2 id="onboarding-discard-title" className="font-display text-xl font-semibold text-slate-950 dark:text-white">
            {t("discardDraftTitle")}
          </h2>
          <p id="onboarding-discard-description" className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            {t("discardDraftBody")}
          </p>
        </div>
        <div className="flex flex-col-reverse gap-3 border-t border-black/[0.06] bg-slate-50 p-5 dark:border-white/[0.06] dark:bg-void-900 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => setShowDiscardConfirmation(false)}
            disabled={dismissing}
            className="rounded-xl border border-black/[0.08] bg-white px-4 py-2.5 text-sm font-bold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-200"
          >
            {t("keepOnboardingDraft")}
          </button>
          <button
            type="button"
            onClick={() => void completeCancellation()}
            disabled={dismissing}
            className="rounded-xl bg-status-red px-4 py-2.5 text-sm font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-status-red/40 disabled:opacity-60"
          >
            {dismissing ? t("discardingDraft") : t("discardDraftAndClose")}
          </button>
        </div>
      </Dialog>
    </>
  );
};

const Choice: FunctionComponent<{
  title: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}> = ({ title, value, options, onChange }) => (
  <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/75 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
    <div className="text-sm font-semibold text-slate-900 dark:text-white">{title}</div>
    <div className="mt-4 flex flex-wrap gap-2" aria-label={title}>
      {options.map(([optionValue, label]) => (
        <button
          key={optionValue}
          type="button"
          aria-pressed={value === optionValue}
          onClick={() => onChange(optionValue)}
          className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-bold transition-colors ${value === optionValue ? "border-signal-500/30 bg-signal-500/12 text-signal-700 dark:text-signal-200" : "border-black/[0.06] bg-white text-slate-500 hover:text-slate-800 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300"}`}
          style={{ transitionDuration: "var(--onboarding-selection-duration)", transitionTimingFunction: "var(--onboarding-selection-ease)" }}
        >
          {value === optionValue ? <Check className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {label}
        </button>
      ))}
    </div>
  </div>
);

const ToggleRow: FunctionComponent<{
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ title, description, checked, onChange }) => (
  <div data-onboarding-card className="flex items-center justify-between gap-4 rounded-3xl border border-black/[0.06] bg-white/75 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
    <div>
      <div className="text-sm font-semibold text-slate-900 dark:text-white">{title}</div>
      <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{description}</div>
    </div>
    <button
      type="button"
      aria-label={title}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 overflow-hidden rounded-full border transition-colors ${checked ? "border-signal-500/30 bg-signal-500" : "border-black/[0.12] bg-slate-200 dark:border-white/[0.12] dark:bg-white/[0.08]"}`}
      aria-pressed={checked}
      style={{ transitionDuration: "var(--onboarding-control-duration)", transitionTimingFunction: "var(--onboarding-control-ease)" }}
    >
      <span className={`absolute left-1 top-1 block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  </div>
);
