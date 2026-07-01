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
  Github,
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
  X,
} from "lucide-preact";
import { fetchOnboardingReadiness } from "../../../lib/api/dashboard-api.js";
import { fetchSystemSettings, saveSystemSettings } from "../../lib/settings-api.js";
import { ONBOARDING_OPEN_EVENT, ONBOARDING_STORAGE_KEY, startDashboardTour } from "../../lib/onboarding-control.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useOnboardingState } from "../../hooks/useOnboardingState.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";
import { OnboardingIntro } from "./OnboardingIntro.js";
import { useOnboardingStepFlow, type StepId } from "./use-onboarding-step-flow.js";
import { OnboardingInstallationStep } from "./OnboardingInstallationStep.js";
import { OnboardingIntroductionStep } from "./OnboardingIntroductionStep.js";
import { OnboardingProvidersStep } from "./OnboardingProvidersStep.js";
import { OnboardingProviderSetupStep } from "./OnboardingProviderSetupStep.js";
import { OnboardingGitStep } from "./OnboardingGitStep.js";
import { OnboardingJiraStep } from "./OnboardingJiraStep.js";
import { OnboardingAutomationStep } from "./OnboardingAutomationStep.js";
import { OnboardingAppearanceStep } from "./OnboardingAppearanceStep.js";
import { OnboardingDefaultsStep } from "./OnboardingDefaultsStep.js";

import { ProviderBrandIcon } from "../providers/ProviderBrandIcon.js";
import { ProviderInstanceCard } from "../settings/ProviderInstanceCard.js";
import { sanitizeSystemProviderConfig } from "../../lib/provider-runtime-preview.js";
import { PillChoiceGroup, Row, SelectInput, TextInput, Toggle } from "../settings/SettingsFormFields.js";
import { applyAppearanceSettings } from "../../lib/apply-appearance.js";
import { SectionCard } from "../settings/panels/SharedPanelComponents.js";
import { JiraIcon } from "../icons/JiraIcon.js";

type IntroPhase = "intro" | "transitioning" | "onboarding";
import type { OnboardingProviderCredentialStatus, OnboardingRuntimeReadiness, ProviderConfigId, ProviderId, ProjectSettings, SystemSettings } from "../../../types.js";
import { getSafeUrl } from "../../lib/safe-url.js";
import {
  buildProviderConfigId,
  getFirstCliProviderConfigId,
  getProviderInitialSelection,
  getSystemProvidersByType,
  syncProjectProvidersToIntegrationCatalog
} from "../../lib/onboarding-settings-draft.js";
import {
  createProjectProviderDraft,
  createSystemProviderDraft,
  getProviderInstanceLabel,
  getProviderTypeLabel,
  sortProviderConfigEntries,
} from "../../lib/settings-view-models.js";

const CODEUX_REPO_URL = "https://github.com/codeux-ai/codeux";

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
};

const PROVIDER_TYPES: ProviderId[] = ["jules", "gemini", "antigravity", "codex", "claude-code", "qwen-code", "opencode"];

const providerDescriptions: Record<ProviderId, string> = {
  jules: "Google Jules API service for agent session and workspace orchestration.",
  gemini: "Gemini CLI with local OAuth auth-copy or API-key based execution.",
  codex: "Codex CLI for OpenAI-powered local container execution.",
  "claude-code": "Claude Code CLI with local auth-copy or provider API key.",
  "qwen-code": "Qwen Code CLI with OAuth, Alibaba Coding Plan, or custom model provider config.",
  opencode: "OpenCode CLI with local auth, provider keys, or OpenAI-compatible endpoints.",
  antigravity: "Antigravity CLI (agy) for Google-powered local container execution.",
};

const getProviderWatermark = (providerId: ProviderId): string => (
  providerId === "jules" ? "JLS"
    : providerId === "gemini" ? "GMN"
      : providerId === "codex" ? "CDX"
        : providerId === "qwen-code" ? "QWN"
          : providerId === "opencode" ? "OPC"
            : providerId === "antigravity" ? "AGY"
              : "CLD"
);

const defaultReadiness: OnboardingRuntimeReadiness = {
  checkedAt: "",
  cluster: {
    status: "not_ready",
    label: "Checking",
    detail: "Runtime checks are loading.",
  },
  dependencies: [],
  providers: [],
};

const cloneSettings = (settings: SystemSettings): SystemSettings => JSON.parse(JSON.stringify(settings)) as SystemSettings;

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

export const OnboardingExperience: FunctionComponent = () => {
  const navigate = useNavigate();
  const backdropRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { activeStep, setActiveStep, activeStepData: active, goToNextStep, goToPreviousStep, resetSteps, steps } = useOnboardingStepFlow();
  const [readiness, setReadiness] = useState<OnboardingRuntimeReadiness>(defaultReadiness);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [selectedProviders, setSelectedProviders] = useState<ProviderId[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [introPhase, setIntroPhase] = useState<IntroPhase>("intro");
  const reducedMotion = useReducedMotion();
  const {
    state: onboardingUserState,
    loading: onboardingStateLoading,
    markCompleted: markOnboardingCompleted,
    reset: resetOnboardingState,
  } = useOnboardingState();

  useEffect(() => {
    if (onboardingStateLoading) {
      return;
    }
    setOpen(!onboardingUserState.completed);
  }, [onboardingStateLoading, onboardingUserState.completed]);

  useEffect(() => {
    const handleOpen = () => {
      resetSteps();
      void resetOnboardingState();
      setOpen(true);
      setIntroPhase("intro");
    };
    window.addEventListener(ONBOARDING_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(ONBOARDING_OPEN_EVENT, handleOpen);
  }, [resetOnboardingState]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        void markOnboardingCompleted("cancel");
        window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, markOnboardingCompleted]);

  const handleIntroExitStart = () => {
    setIntroPhase("transitioning");
  };

  const handleIntroComplete = () => {
    setIntroPhase("onboarding");
  };

  const load = async () => {
    try {
      const [nextReadiness, nextSettings] = await Promise.all([
        fetchOnboardingReadiness(),
        fetchSystemSettings(),
      ]);
      setReadiness(nextReadiness);
      setSettings(nextSettings);
      setSelectedProviders((current) => current.length > 0 ? current : getProviderInitialSelection(nextReadiness.providers, nextSettings));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  };

  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !shellRef.current) {
      return;
    }
    const ctx = gsap.context(() => {
      gsap.fromTo(
        backdropRef.current,
        { opacity: 0 },
        { opacity: 1, duration: reducedMotion ? 0 : MODAL_MOTION.backdrop.duration, ease: MODAL_MOTION.backdrop.ease },
      );
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
          duration: reducedMotion ? 0 : 0.72,
          ease: MODAL_MOTION.entry.ease,
          clearProps: "filter",
        },
      );
      if (sideRef.current) {
        gsap.fromTo(
          sideRef.current.querySelectorAll("[data-step-item], [data-sidebar-copy]"),
          { opacity: 0, x: reducedMotion ? 0 : -18 },
          { opacity: 1, x: 0, duration: reducedMotion ? 0 : 0.65, stagger: reducedMotion ? 0 : 0.055, ease: "power3.out", delay: reducedMotion ? 0 : 0.12 },
        );
      }
    });
    return () => ctx.revert();
  }, [open, reducedMotion]);

  useLayoutEffect(() => {
    if (!contentRef.current) {
      return;
    }
    const ctx = gsap.context(() => {
      gsap.fromTo(
        contentRef.current!.querySelectorAll("[data-onboarding-card]"),
        { opacity: 0, y: reducedMotion ? 0 : 22, scale: reducedMotion ? 1 : 0.985 },
        { opacity: 1, y: 0, scale: 1, duration: reducedMotion ? 0 : 0.55, stagger: reducedMotion ? 0 : 0.055, ease: "power3.out" },
      );
    });
    return () => ctx.revert();
  }, [activeStep, selectedProviders.length, settings, reducedMotion]);

    const readinessByProvider = useMemo(
    () => Object.fromEntries(readiness.providers.map((provider) => [provider.provider, provider])) as Partial<Record<ProviderId, OnboardingProviderCredentialStatus>>,
    [readiness.providers],
  );
  const selectedProviderTypes = useMemo(
    () => PROVIDER_TYPES.filter((provider) => selectedProviders.includes(provider)),
    [readiness.providers, selectedProviders],
  );

  const updateSettings = (recipe: (current: SystemSettings) => SystemSettings) => {
    setSettings((current) => current ? recipe(cloneSettings(current)) : current);
  };

  const updateAppearance = (updates: Partial<SystemSettings["defaults"]["appearance"]>) => {
    updateSettings((current) => {
      const nextAppearance = {
        ...current.defaults.appearance,
        ...updates,
      };
      applyAppearanceSettings(nextAppearance);
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
    setSelectedProviders((current) => {
      const nextSelected = current.includes(provider)
        ? current.filter((item) => item !== provider)
        : [...current, provider];
      if (!current.includes(provider)) {
        ensureProviderInstance(provider);
      }
      return nextSelected;
    });
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
    setSelectedProviders((current) => current.includes(provider) ? current : [...current, provider]);
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

  const applyAndClose = async () => {
    if (!settings) {
      await markOnboardingCompleted("complete");
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
      setOpen(false);
      await navigate({ to: "/" });
      window.setTimeout(startDashboardTour, 260);
      return;
    }
    setSaving(true);
    try {
      let nextSettings = cloneSettings(settings);
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
      setSettings(nextSettings);
      await markOnboardingCompleted("complete");
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
      setOpen(false);
      await navigate({ to: "/" });
      window.setTimeout(startDashboardTour, 260);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return null;
  }

  const stepNeedsSettings: StepId[] = ["provider-setup", "git", "jira", "automation", "appearance", "defaults"];
  const canGoNext = !stepNeedsSettings.includes(active.id) || Boolean(settings);
  const clusterReady = readiness.cluster.status === "ready";
  const dockerExecutionEnabled = settings?.defaults.cliWorkflow.executionMode === "DOCKER";
  const jiraSettings = settings?.integrations.jira || DEFAULT_JIRA_SETTINGS;
  const enabledProviderInstances = settings
    ? sortProviderConfigEntries(Object.entries(settings.defaults.aiProvider.providers))
      .filter(([, provider]) => provider.enabled)
    : [];
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

  return (
    <>
      {introPhase !== "onboarding" && (
        <OnboardingIntro onExitStart={handleIntroExitStart} onComplete={handleIntroComplete} />
      )}
      {introPhase !== "intro" && (
    <div ref={backdropRef} className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden bg-[#060A0D] px-3 py-4 md:px-6 md:py-8">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <Suspense fallback={<div className="absolute inset-0 bg-[#060A0D]" />}>
          <DeepOceanBackground forceDark className="opacity-75 saturate-[0.86] contrast-[0.92]" />
        </Suspense>
        <div className="absolute inset-0 bg-[#05070B]/54 backdrop-blur-[1px]" />
        <div className="absolute inset-x-0 top-0 h-56 bg-[linear-gradient(180deg,rgba(0,224,160,0.12),rgba(5,7,11,0.02)_58%,transparent)]" />
        <div className="absolute inset-x-0 bottom-0 h-72 bg-[linear-gradient(0deg,rgba(255,184,0,0.08),rgba(5,7,11,0.02)_62%,transparent)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_17%_16%,rgba(0,224,160,0.1),transparent_31%),radial-gradient(circle_at_80%_78%,rgba(255,184,0,0.075),transparent_34%),linear-gradient(115deg,rgba(255,255,255,0.055)_0%,transparent_20%,transparent_72%,rgba(0,224,160,0.05)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,7,10,0.18),rgba(4,7,10,0.62))]" />
      </div>
      <section
        ref={shellRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="relative z-10 grid h-[calc(100vh-2rem)] max-h-[940px] min-h-0 w-full max-w-[1360px] grid-rows-[minmax(0,1fr)] overflow-hidden rounded-[2rem] border border-white/15 bg-[#F9F8F4]/96 shadow-[0_30px_90px_rgba(0,0,0,0.46)] backdrop-blur-2xl dark:bg-void-900/96 md:h-[calc(100vh-4rem)] md:grid-cols-[330px_1fr]"
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 z-20 rounded-[2rem] ring-1 ring-inset ring-white/10" />
        <aside ref={sideRef} className="relative hidden h-full min-h-0 overflow-hidden border-r border-white/10 bg-[#0B0F14] p-7 text-white md:block">
          <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(0,224,160,0.16),transparent_34%),linear-gradient(330deg,rgba(255,184,0,0.13),transparent_38%)]" />
          <span className="pointer-events-none absolute -left-5 -top-3 select-none font-display text-[8rem] font-black leading-none tracking-tighter text-white/[0.035]">
            RUN
          </span>
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-56 w-56 animate-organic bg-signal-500/[0.08]" style={{ borderRadius: "40% 60% 70% 30% / 40% 50% 60% 50%" }} />
            <div className="absolute h-40 w-40 animate-organic-reverse bg-ember-500/[0.12]" style={{ borderRadius: "40% 60% 70% 30% / 40% 50% 60% 50%" }} />
            <div className="absolute h-24 w-24 animate-organic bg-signal-500/[0.18]" style={{ borderRadius: "40% 60% 70% 30% / 40% 50% 60% 50%" }} />
          </div>
          <div className="absolute inset-x-7 top-24 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          <div className="relative z-10">
            <div data-sidebar-copy className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/10 shadow-[0_0_35px_rgba(0,224,160,0.12)]">
              <Compass className="h-5 w-5 text-signal-300" />
            </div>
            <div data-sidebar-copy className="mt-8 text-[10px] font-bold uppercase tracking-[0.24em] text-signal-300">Code UX Setup</div>
            <h2 data-sidebar-copy id="onboarding-title" className="mt-3 font-display text-5xl font-black leading-[0.9] tracking-tight text-white">
              Make the runtime ready.
            </h2>
            <div data-sidebar-copy className="mt-5 text-sm font-medium leading-relaxed text-slate-300">
              Configure containers, provider auth, automation, and the workspace shell before the first sprint starts.
            </div>
            <div data-sidebar-copy className="mt-6 grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3">
                <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Providers</div>
                <div className="mt-1 text-2xl font-black text-white">{selectedProviders.length}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3">
                <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Cluster</div>
                <div aria-live="polite" className={`mt-2 inline-flex rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] ${clusterReady ? "bg-signal-400/15 text-signal-200" : "bg-status-amber/15 text-status-amber"}`}>
                  {clusterReady ? "Ready" : "Blocked"}
                </div>
              </div>
            </div>
            <div className="mt-8 space-y-2">
              {[
                {
                  id: "installation",
                  label: "Installation",
                  icon: Box,
                  active: activeStep === 0,
                  complete: activeStep > 0,
                  onClick: () => resetSteps(),
                },
                {
                  id: "introduction",
                  label: "Introduction",
                  icon: ShieldCheck,
                  active: activeStep === 1,
                  complete: activeStep > 1,
                  onClick: () => setActiveStep(1),
                },
                {
                  id: "providers",
                  label: "Select Providers",
                  icon: Cpu,
                  active: activeStep === 2,
                  complete: activeStep > 2,
                  onClick: () => setActiveStep(2),
                },
                {
                  id: "configure-flow",
                  label:
                    activeStep === 3 ? "Providers (1/4)"
                    : activeStep === 4 ? "Git (2/4)"
                    : activeStep === 5 ? "Jira (3/4)"
                    : activeStep === 6 ? "Default providers (4/4)"
                    : "Providers (1/4)",
                  icon: Settings,
                  active: activeStep >= 3 && activeStep <= 6,
                  complete: activeStep > 6,
                  onClick: () => {
                    setActiveStep(activeStep >= 3 && activeStep <= 6 ? activeStep : 3);
                  },
                },
                {
                  id: "automation",
                  label: "Automation",
                  icon: Sparkles,
                  active: activeStep === 7,
                  complete: activeStep > 7,
                  onClick: () => setActiveStep(7),
                },
                {
                  id: "appearance",
                  label: "Appearance",
                  icon: Monitor,
                  active: activeStep === 8,
                  complete: activeStep > 8,
                  onClick: () => setActiveStep(8),
                },
              ].map((step) => {
                const StepIcon = step.icon;
                const activeItem = step.active;
                const complete = step.complete;
                return (
                  <button
                    key={step.id}
                    data-step-item
                    type="button"
                    aria-current={activeItem ? "step" : undefined}
                    onClick={step.onClick}
                    className={`group flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-[background-color,border-color,transform] hover:translate-x-1 ${
                      activeItem ? "border-white/30 bg-white text-slate-950 shadow-[0_16px_40px_rgba(0,0,0,0.18)]" : "border-white/0 text-slate-300 hover:border-white/10 hover:bg-white/8 hover:text-white"
                    }`}
                  >
                    <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${activeItem ? "bg-signal-500/14 text-signal-700" : complete ? "bg-signal-400/15 text-signal-300" : "bg-white/8 text-slate-300"}`}>
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
                {activeStep < 3 ? `Step ${activeStep + 1} of 6`
                  : activeStep >= 3 && activeStep <= 6 ? `Step 4 of 6 (${activeStep - 2}/4)`
                  : `Step ${activeStep - 2} of 6`}
              </div>
              <h3 className="mt-1 font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">{active.label}</h3>
            </div>
            <button
              type="button"
              onClick={async () => {
                await markOnboardingCompleted("cancel");
                window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
                setOpen(false);
              }}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-black/[0.05] hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 dark:hover:bg-white/[0.06] dark:hover:text-white"
              aria-label="Close onboarding"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <div ref={contentRef} className="dashboard-scrollbar relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 dark:text-slate-100 md:px-8">
            {error ? (
              <div className="mb-4 rounded-2xl border border-status-red/20 bg-status-red/10 px-4 py-3 text-sm font-semibold text-status-red">
                {error}
              </div>
            ) : null}

            {active.id === "installation" ? (
              <OnboardingInstallationStep
                clusterReady={clusterReady}
                readiness={readiness}
                osInfo={getOSInfo(platform)}
              />
            ) : null}

            {active.id === "introduction" ? (
              <OnboardingIntroductionStep />
            ) : null}

            {active.id === "providers" ? (
              <OnboardingProvidersStep
                selectedProviders={selectedProviders}
                toggleProvider={toggleProvider}
                readinessByProvider={readinessByProvider}
                settings={settings}
              />
            ) : null}

            {active.id === "provider-setup" ? (
              <OnboardingProviderSetupStep
                selectedProviderTypes={selectedProviderTypes}
                settings={settings}
                readinessByProvider={readinessByProvider}
                dockerExecutionEnabled={dockerExecutionEnabled}
                addProviderInstance={addProviderInstance}
                configureProviderInstance={configureProviderInstance}
                removeProviderInstance={removeProviderInstance}
                configureProjectProvider={configureProjectProvider}
              />
            ) : null}

            {active.id === "git" && settings ? (
              <OnboardingGitStep
                settings={settings}
                gitMode={gitMode}
                updateCliWorkflow={updateCliWorkflow}
              />
            ) : null}

            {active.id === "jira" && settings ? (
              <OnboardingJiraStep
                settings={settings}
                jiraSettings={jiraSettings}
                updateJira={updateJira}
              />
            ) : null}

            {active.id === "automation" && settings ? (
              <OnboardingAutomationStep
                settings={settings}
                updateSettings={updateSettings}
              />
            ) : null}

            {active.id === "appearance" && settings ? (
              <OnboardingAppearanceStep
                settings={settings}
                updateAppearance={updateAppearance}
              />
            ) : null}

            {active.id === "defaults" && settings ? (
              <OnboardingDefaultsStep
                settings={settings}
                providerInstanceOptions={providerInstanceOptions}
                workerInstanceOptions={workerInstanceOptions}
                updateSettings={updateSettings}
              />
            ) : null}
          </div>

          <footer className="relative flex shrink-0 items-center justify-between gap-3 border-t border-black/[0.06] bg-white/45 px-5 py-4 backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-950/28 md:px-8">
            <button
              type="button"
              disabled={activeStep === 0}
              onClick={() => goToPreviousStep()}
              className="inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-bold text-slate-500 transition-colors hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.06]"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <div className="flex items-center gap-2">
              {[
                { active: activeStep === 0, onClick: () => resetSteps(), label: "Installation" },
                { active: activeStep === 1, onClick: () => setActiveStep(1), label: "Introduction" },
                { active: activeStep === 2, onClick: () => setActiveStep(2), label: "Select Providers" },
                { active: activeStep >= 3 && activeStep <= 6, onClick: () => setActiveStep(activeStep >= 3 && activeStep <= 6 ? activeStep : 3), label: "Providers" },
                { active: activeStep === 7, onClick: () => setActiveStep(7), label: "Automation" },
                { active: activeStep === 8, onClick: () => setActiveStep(8), label: "Appearance" },
              ].map((dot, idx) => (
                <button
                  key={`dot-${idx}`}
                  type="button"
                  aria-label={`Go to ${dot.label}`}
                  onClick={dot.onClick}
                  className={`h-2 rounded-full transition-all ${dot.active ? "w-8 bg-signal-500" : "w-2 bg-slate-300 dark:bg-slate-700"}`}
                />
              ))}
            </div>
            {activeStep === steps.length - 1 ? (
              <button
                type="button"
                onClick={() => void applyAndClose()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white shadow-[0_12px_28px_rgba(15,23,42,0.18)] transition-colors hover:bg-slate-700 disabled:opacity-60 dark:bg-white dark:text-void-900"
              >
                {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Finish
              </button>
            ) : (
              <button
                type="button"
                disabled={!canGoNext}
                onClick={() => goToNextStep()}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white shadow-[0_12px_28px_rgba(15,23,42,0.18)] transition-colors hover:bg-slate-700 disabled:opacity-60 dark:bg-white dark:text-void-900"
              >
                Next
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </footer>
        </div>
      </section>
    </div>
      )}
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
    <div className="text-sm font-black text-slate-900 dark:text-white">{title}</div>
    <div className="mt-4 flex flex-wrap gap-2">
      {options.map(([optionValue, label]) => (
        <button
          key={optionValue}
          type="button"
          onClick={() => onChange(optionValue)}
          className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-bold transition-colors ${value === optionValue ? "border-signal-500/30 bg-signal-500/12 text-signal-700 dark:text-signal-200" : "border-black/[0.06] bg-white text-slate-500 hover:text-slate-800 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300"}`}
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
      <div className="text-sm font-black text-slate-900 dark:text-white">{title}</div>
      <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{description}</div>
    </div>
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 overflow-hidden rounded-full border transition-colors ${checked ? "border-signal-500/30 bg-signal-500" : "border-black/[0.12] bg-slate-200 dark:border-white/[0.12] dark:bg-white/[0.08]"}`}
      aria-pressed={checked}
    >
      <span className={`absolute left-1 top-1 block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  </div>
);
