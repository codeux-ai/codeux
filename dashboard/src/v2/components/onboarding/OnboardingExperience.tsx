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
  Compass,
  Cpu,
  BookOpen,
  FolderOpen,
  Github,
  Info,
  KeyRound,
  Monitor,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-preact";
import { fetchOnboardingReadiness } from "../../../lib/api/dashboard-api.js";
import { fetchSystemSettings, saveSystemSettings } from "../../lib/settings-api.js";
import { ONBOARDING_OPEN_EVENT, ONBOARDING_STORAGE_KEY, startDashboardTour } from "../../lib/onboarding-control.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";
import { OnboardingIntro } from "./OnboardingIntro.js";

const INTRO_SEEN_KEY = "cux-onboarding-intro-seen";
type IntroPhase = "intro" | "transitioning" | "onboarding";
import type { OnboardingProviderCredentialStatus, OnboardingRuntimeReadiness, ProviderConfigId, ProviderId, ProjectSettings, SystemSettings } from "../../../types.js";
import {
  createProjectProviderDraft,
  createSystemProviderDraft,
  getProviderTypeLabel,
  sortProviderConfigEntries,
} from "../../lib/settings-view-models.js";

const DeepOceanBackground = lazy(async () => {
  const mod = await import("../chat/DeepOceanBackground.js");
  return { default: mod.DeepOceanBackground as FunctionComponent<{ forceDark?: boolean; className?: string }> };
});

type StepId = "installation" | "introduction" | "providers" | "provider-setup" | "automation" | "appearance";

const steps: Array<{ id: StepId; label: string; icon: typeof Settings }> = [
  { id: "installation", label: "Installation", icon: Box },
  { id: "introduction", label: "Introduction", icon: ShieldCheck },
  { id: "providers", label: "Providers", icon: Cpu },
  { id: "provider-setup", label: "Configure", icon: Settings },
  { id: "automation", label: "Automation", icon: Sparkles },
  { id: "appearance", label: "Appearance", icon: Monitor },
];

const providerMountFields: Partial<Record<ProviderId, keyof SystemSettings["defaults"]["cliWorkflow"]>> = {
  gemini: "containerMountGeminiAuth",
  codex: "containerMountCodexAuth",
  "claude-code": "containerMountClaudeCodeAuth",
  "qwen-code": "containerMountQwenCodeAuth",
  opencode: "containerMountOpenCodeAuth",
};

const providerLabels: Record<ProviderId, string> = {
  jules: "Jules",
  gemini: "Gemini",
  codex: "Codex",
  "claude-code": "Claude Code",
  "qwen-code": "Qwen Code",
  opencode: "OpenCode",
};

const PROVIDER_TYPES: ProviderId[] = ["jules", "gemini", "codex", "claude-code", "qwen-code", "opencode"];

const providerDescriptions: Record<ProviderId, string> = {
  jules: "Hosted Jules Agent API for primary remote coding sessions.",
  gemini: "Gemini CLI with local OAuth auth-copy or API-key based execution.",
  codex: "Codex CLI for OpenAI-powered local container execution.",
  "claude-code": "Claude Code CLI with local auth-copy or provider API key.",
  "qwen-code": "Qwen Code CLI with OAuth, Alibaba Coding Plan, or custom model provider config.",
  opencode: "OpenCode CLI with local auth, provider keys, or OpenAI-compatible endpoints.",
};

const getProviderWatermark = (providerId: ProviderId): string => (
  providerId === "jules" ? "JLS"
    : providerId === "gemini" ? "GMN"
      : providerId === "codex" ? "CDX"
        : providerId === "qwen-code" ? "QWN"
          : providerId === "opencode" ? "OPC"
            : "CLD"
);

const buildProviderConfigId = (providerId: ProviderId): ProviderConfigId => (
  `${providerId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
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

const getProviderInitialSelection = (
  providers: OnboardingProviderCredentialStatus[],
  settings: SystemSettings,
): ProviderId[] => {
  const detected = providers
    .filter((provider) => provider.available || provider.mountEnabled)
    .map((provider) => provider.provider);
  const enabled = Object.values(settings.defaults.aiProvider.providers)
    .filter((provider) => provider.enabled)
    .map((provider) => provider.provider);
  return Array.from(new Set<ProviderId>(["jules", ...enabled, ...detected]));
};

const cloneSettings = (settings: SystemSettings): SystemSettings => JSON.parse(JSON.stringify(settings)) as SystemSettings;

const getSystemProvidersByType = (
  settings: SystemSettings | null,
  providerId: ProviderId,
): Array<[ProviderConfigId, SystemSettings["integrations"]["providers"][ProviderConfigId]]> => (
  sortProviderConfigEntries(Object.entries(settings?.integrations.providers || {})
    .filter(([, provider]) => provider.provider === providerId) as Array<[ProviderConfigId, SystemSettings["integrations"]["providers"][ProviderConfigId]]>)
);

const getFirstCliProviderConfigId = (providers: ProjectSettings["aiProvider"]["providers"]): ProviderConfigId | null => (
  Object.entries(providers).find(([, provider]) => provider.provider !== "jules")?.[0] || null
);

const syncProjectProvidersToIntegrationCatalog = (
  settings: SystemSettings,
  nextIntegrationProviders: SystemSettings["integrations"]["providers"],
): ProjectSettings => {
  const nextProjectProviders = Object.fromEntries(
    Object.entries(nextIntegrationProviders).map(([providerConfigId, provider]) => [
      providerConfigId,
      settings.defaults.aiProvider.providers[providerConfigId]
        ? {
          ...settings.defaults.aiProvider.providers[providerConfigId],
          provider: provider.provider,
          name: provider.name,
        }
        : createProjectProviderDraft(provider.provider, provider.name),
    ]),
  ) as ProjectSettings["aiProvider"]["providers"];

  const nextInvocationRouting = Object.fromEntries(
    Object.entries(settings.defaults.aiProvider.invocationRouting).map(([routeId, route]) => [
      routeId,
      {
        ...route,
        provider: route.provider && nextProjectProviders[route.provider] ? route.provider : null,
        allowedProviders: route.allowedProviders.filter((providerConfigId) => nextProjectProviders[providerConfigId]),
        providers: Object.fromEntries(
          Object.entries(route.providers).filter(([providerConfigId]) => nextProjectProviders[providerConfigId]),
        ),
      },
    ]),
  ) as ProjectSettings["aiProvider"]["invocationRouting"];

  const fallbackGlobalProvider = settings.defaults.aiProvider.provider && nextProjectProviders[settings.defaults.aiProvider.provider]
    ? settings.defaults.aiProvider.provider
    : Object.keys(nextProjectProviders)[0] || null;
  const fallbackWorkerProvider = nextProjectProviders[settings.defaults.workers.virtualWorkerProvider]
    ? settings.defaults.workers.virtualWorkerProvider
    : getFirstCliProviderConfigId(nextProjectProviders) || fallbackGlobalProvider || settings.defaults.workers.virtualWorkerProvider;

  return {
    ...settings.defaults,
    aiProvider: {
      ...settings.defaults.aiProvider,
      provider: fallbackGlobalProvider,
      providers: nextProjectProviders,
      invocationRouting: nextInvocationRouting,
    },
    workers: {
      ...settings.defaults.workers,
      virtualWorkerProvider: fallbackWorkerProvider,
    },
  };
};

export const OnboardingExperience: FunctionComponent = () => {
  const navigate = useNavigate();
  const backdropRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [readiness, setReadiness] = useState<OnboardingRuntimeReadiness>(defaultReadiness);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [selectedProviders, setSelectedProviders] = useState<ProviderId[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [introPhase, setIntroPhase] = useState<IntroPhase>(() =>
    typeof window !== "undefined" && window.localStorage.getItem(INTRO_SEEN_KEY) === "true" ? "onboarding" : "intro",
  );
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const completed = window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === "true";
    setOpen(!completed);
    const handleOpen = () => {
      setActiveStep(0);
      setOpen(true);
      if (window.localStorage.getItem(INTRO_SEEN_KEY) !== "true") {
        setIntroPhase("intro");
      }
    };
    window.addEventListener(ONBOARDING_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(ONBOARDING_OPEN_EVENT, handleOpen);
  }, []);

  const handleIntroExitStart = () => {
    setIntroPhase("transitioning");
  };

  const handleIntroComplete = () => {
    try {
      window.localStorage.setItem(INTRO_SEEN_KEY, "true");
    } catch {
      /* localStorage may be unavailable; intro will replay next time, no functional issue */
    }
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

  const active = steps[activeStep] ?? steps[0]!;
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
        [providerConfigId]: {
          ...provider,
          ...updates,
        },
      };
      const mountField = providerMountFields[provider.provider];
      const syncedDefaults = syncProjectProvidersToIntegrationCatalog(current, nextProviders);
      if (mountField && updates.mountAuth !== undefined) {
        syncedDefaults.cliWorkflow[mountField] = updates.mountAuth as never;
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

  const configureAuthMode = (
    providerConfigId: ProviderConfigId,
    mode: "LOCAL_AUTH" | "API_KEY" | "CUSTOM_PROVIDER" | "ALIBABA_CODING_PLAN",
  ) => {
    const provider = settings?.integrations.providers[providerConfigId];
    if (!provider) {
      return;
    }
    if (provider.provider === "qwen-code") {
      configureProviderInstance(providerConfigId, {
        qwenAuthMode: mode === "API_KEY" || mode === "CUSTOM_PROVIDER" ? "MODEL_PROVIDER" : mode,
        mountAuth: mode === "LOCAL_AUTH",
      });
      return;
    }
    if (provider.provider === "opencode") {
      configureProviderInstance(providerConfigId, {
        openCodeAuthMode: mode === "API_KEY" ? "ENV_KEY" : mode === "CUSTOM_PROVIDER" ? "CUSTOM_PROVIDER" : "LOCAL_AUTH",
        mountAuth: mode === "LOCAL_AUTH",
      });
      return;
    }
    configureProviderInstance(providerConfigId, { mountAuth: mode === "LOCAL_AUTH" });
  };

  const getAuthMode = (provider: SystemSettings["integrations"]["providers"][ProviderConfigId]): "LOCAL_AUTH" | "API_KEY" | "CUSTOM_PROVIDER" | "ALIBABA_CODING_PLAN" => {
    if (provider.provider === "jules") {
      return "API_KEY";
    }
    if (provider.provider === "qwen-code") {
      return provider.qwenAuthMode === "ALIBABA_CODING_PLAN"
        ? "ALIBABA_CODING_PLAN"
        : provider.qwenAuthMode === "MODEL_PROVIDER"
          ? "CUSTOM_PROVIDER"
          : "LOCAL_AUTH";
    }
    if (provider.provider === "opencode") {
      return provider.openCodeAuthMode === "CUSTOM_PROVIDER"
        ? "CUSTOM_PROVIDER"
        : provider.openCodeAuthMode === "ENV_KEY"
          ? "API_KEY"
          : "LOCAL_AUTH";
    }
    return provider.mountAuth ? "LOCAL_AUTH" : "API_KEY";
  };

  const applyAndClose = async () => {
    if (!settings) {
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
      const firstSelectedCliProvider = Object.entries(nextSettings.defaults.aiProvider.providers)
        .find(([, provider]) => provider.enabled && provider.provider !== "jules")?.[0];
      if (firstSelectedCliProvider) {
        nextSettings.defaults.workers.virtualWorkerProvider = firstSelectedCliProvider;
      }
      nextSettings = await saveSystemSettings(nextSettings);
      setSettings(nextSettings);
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

  const canGoNext = active.id !== "provider-setup" || selectedProviders.length === 0 || Boolean(settings);
  const clusterReady = readiness.cluster.status === "ready";

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
        className="relative z-10 grid h-[calc(100vh-2rem)] max-h-[900px] min-h-0 w-full max-w-[1280px] grid-rows-[minmax(0,1fr)] overflow-hidden rounded-[2rem] border border-white/15 bg-[#F9F8F4]/96 shadow-[0_30px_90px_rgba(0,0,0,0.46)] backdrop-blur-2xl dark:bg-void-900/96 md:h-[calc(100vh-4rem)] md:grid-cols-[330px_1fr]"
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
                <div className={`mt-2 inline-flex rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] ${clusterReady ? "bg-signal-400/15 text-signal-200" : "bg-status-amber/15 text-status-amber"}`}>
                  {clusterReady ? "Ready" : "Blocked"}
                </div>
              </div>
            </div>
            <div className="mt-8 space-y-2">
              {steps.map((step, index) => {
                const StepIcon = step.icon;
                const activeItem = index === activeStep;
                const complete = index < activeStep;
                return (
                  <button
                    key={step.id}
                    data-step-item
                    type="button"
                    onClick={() => setActiveStep(index)}
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
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Step {activeStep + 1} of {steps.length}</div>
              <h3 className="mt-1 font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">{active.label}</h3>
            </div>
            <button
              type="button"
              onClick={() => {
                window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
                setOpen(false);
              }}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-black/[0.05] hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 dark:hover:bg-white/[0.06] dark:hover:text-white"
              aria-label="Close onboarding"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <main ref={contentRef} className="dashboard-scrollbar relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 dark:text-slate-100 md:px-8">
            {error ? (
              <div className="mb-4 rounded-2xl border border-status-red/20 bg-status-red/10 px-4 py-3 text-sm font-semibold text-status-red">
                {error}
              </div>
            ) : null}

            {active.id === "installation" ? (
              <div className="space-y-5">
                <div data-onboarding-card className={`relative overflow-hidden rounded-3xl border p-5 shadow-[0_18px_45px_rgba(15,23,42,0.05)] ${clusterReady ? "border-signal-500/20 bg-signal-500/8" : "border-status-amber/25 bg-status-amber/10"}`}>
                  <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent" />
                  <div className="flex items-start gap-4">
                    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${clusterReady ? "bg-signal-500/12 text-signal-600" : "bg-status-amber/15 text-status-amber"}`}>
                      {clusterReady ? <Check className="h-6 w-6" /> : <Info className="h-6 w-6" />}
                    </div>
                    <div>
                      <div className="text-lg font-black text-slate-900 dark:text-white">{readiness.cluster.label}</div>
                      <div className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{readiness.cluster.detail}</div>
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {readiness.dependencies.map((dependency) => (
                    <div data-onboarding-card key={dependency.id} className="rounded-2xl border border-black/[0.06] bg-white/75 p-4 shadow-[0_10px_30px_rgba(15,23,42,0.035)] dark:border-white/[0.06] dark:bg-white/[0.04]">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-bold text-slate-900 dark:text-white">{dependency.label}</div>
                        <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] ${dependency.status === "ready" ? "bg-signal-500/10 text-signal-700 dark:text-signal-300" : "bg-status-amber/10 text-status-amber"}`}>
                          {dependency.status}
                        </span>
                      </div>
                      <div className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{dependency.description}</div>
                      {dependency.status !== "ready" ? (
                        <div className="mt-3 rounded-xl bg-black/[0.04] p-3 text-xs leading-relaxed text-slate-600 dark:bg-white/[0.05] dark:text-slate-300">
                          {dependency.resolution}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-2xl border border-black/[0.08] bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-200">
                  <RefreshCw className="h-4 w-4" />
                  Recheck
                </button>
              </div>
            ) : null}

            {active.id === "introduction" ? (
              <div className="space-y-4">
                <div data-onboarding-card className="relative overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/80 p-6 shadow-[0_18px_48px_rgba(15,23,42,0.055)] dark:border-white/[0.06] dark:bg-white/[0.045]">
                  <div aria-hidden className="absolute -right-8 -top-10 font-display text-[7rem] font-black leading-none tracking-tight text-black/[0.025] dark:text-white/[0.025]">UX</div>
                  <div className="relative z-10 max-w-3xl">
                    <div className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-signal-700 dark:text-signal-200">
                      <Sparkles className="h-3.5 w-3.5" strokeWidth={2.4} />
                      Agentic runtime
                    </div>
                    <h4 className="mt-4 font-display text-3xl font-black leading-none tracking-tight text-slate-950 dark:text-white">Welcome to Code UX.</h4>
                    <p className="mt-3 text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300">
                      Code UX is an advanced containerized agentic workspace for turning projects into guided sprints, executable tasks, live previews, and measurable delivery. It coordinates provider CLIs inside isolated Docker runtimes, keeps credentials inside the intended tools, and gives you one polished control surface for agents, memory, browser sessions, and automation.
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2">
                      {[
                        [Github, "GitHub", "#"],
                        [Star, "Star on GitHub", "#"],
                        [BookOpen, "Documentation", "#"],
                      ].map(([Icon, label, href]) => {
                        const BadgeIcon = Icon as typeof Github;
                        return (
                          <a
                            key={String(label)}
                            href={String(href)}
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
                <div className="grid gap-4 md:grid-cols-3">
                  {[
                    ["Container-first execution", "Provider CLIs run inside isolated Docker containers with a mounted workspace snapshot."],
                    ["Credential boundary", "Local credentials are copied only into the intended CLI runtime and are not used as raw application secrets."],
                    ["TOS-compliant workflow", "Authentication stays with each provider's supported CLI flow, so Code UX orchestrates tools instead of impersonating providers."],
                  ].map(([title, description]) => (
                    <div data-onboarding-card key={title} className="group rounded-3xl border border-black/[0.06] bg-white/75 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.045)] transition-transform hover:-translate-y-1 dark:border-white/[0.06] dark:bg-white/[0.04]">
                      <ShieldCheck className="h-6 w-6 text-signal-600 dark:text-signal-300" />
                      <div className="mt-4 text-base font-black text-slate-900 dark:text-white">{title}</div>
                      <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{description}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {active.id === "providers" ? (
              <div className="space-y-4">
                <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
                  <div className="flex items-start gap-3">
                    <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-signal-600 dark:text-signal-300" />
                    <div>
                      <div className="text-base font-black text-slate-900 dark:text-white">Choose every provider you want available</div>
                      <div className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                        You can use local auth-copy, API keys, or both. The next step lets you add multiple named instances for each provider.
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
                        onClick={() => toggleProvider(providerId)}
                        className={`group relative overflow-hidden rounded-3xl border p-4 text-left shadow-[0_14px_34px_rgba(15,23,42,0.04)] transition-[border-color,background-color,transform,box-shadow] hover:-translate-y-1 ${selected ? "border-signal-500/30 bg-signal-500/10 shadow-[0_18px_46px_rgba(0,224,160,0.08)]" : "border-black/[0.06] bg-white/75 hover:border-black/[0.12] dark:border-white/[0.06] dark:bg-white/[0.04]"}`}
                      >
                        <div aria-hidden className={`absolute left-0 top-4 bottom-4 w-1 rounded-r-full transition-opacity ${selected ? "bg-signal-500 opacity-100" : "bg-slate-300 opacity-0 group-hover:opacity-100 dark:bg-slate-600"}`} />
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-black/[0.06] bg-black/[0.03] font-display text-xs font-black tracking-[0.14em] text-slate-700 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-white">
                              {getProviderWatermark(providerId)}
                            </div>
                            <div>
                              <div className="font-black text-slate-900 dark:text-white">{providerLabels[providerId]}</div>
                              <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{instanceCount || 1} instance{(instanceCount || 1) === 1 ? "" : "s"}</div>
                            </div>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] ${provider?.available ? "bg-signal-500/10 text-signal-700 dark:text-signal-300" : selected ? "bg-ember-500/10 text-ember-600 dark:text-ember-400" : "bg-slate-500/10 text-slate-500"}`}>
                            {providerId === "jules" ? "API key" : provider?.available ? "Detected" : selected ? "Configure" : "Optional"}
                          </span>
                        </div>
                        <div className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{provider?.description || providerDescriptions[providerId]}</div>
                        <div className="mt-3 font-mono text-[11px] text-slate-400">{provider?.authPath || (providerId === "jules" ? "API key only" : "Auth path configurable")}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {active.id === "provider-setup" ? (
              <div className="space-y-4">
                {selectedProviderTypes.length === 0 ? (
                  <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/75 p-6 text-sm text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04]">
                    No providers selected. You can add provider credentials later in Settings.
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
                        <div>
                          <div className="text-base font-black text-slate-900 dark:text-white">{providerLabels[providerId]}</div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {readinessStatus?.detectedFiles.length ? `Detected: ${readinessStatus.detectedFiles.join(", ")}` : providerDescriptions[providerId]}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => addProviderInstance(providerId)}
                          className="inline-flex items-center gap-2 rounded-2xl border border-signal-500/20 bg-signal-500/10 px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-signal-700 hover:bg-signal-500/15 dark:text-signal-200"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add instance
                        </button>
                      </div>

                      <div className="relative z-10 mt-4 space-y-3">
                        {providerEntries.length === 0 ? (
                          <div className="rounded-2xl border border-ember-500/20 bg-ember-500/10 p-4 text-sm text-ember-700 dark:text-ember-300">
                            Add an instance to configure {providerLabels[providerId]} credentials.
                          </div>
                        ) : providerEntries.map(([providerConfigId, integrationProvider]) => {
                          const projectProvider = settings?.defaults.aiProvider.providers[providerConfigId];
                          const authMode = getAuthMode(integrationProvider);
                          const showLocalAuth = providerId !== "jules" && authMode === "LOCAL_AUTH";
                          const showApiKey = authMode !== "LOCAL_AUTH" || providerId === "jules";
                          return (
                            <div key={providerConfigId} className="rounded-3xl border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.035]">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-[220px] flex-1">
                                  <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                    Instance name
                                    <input
                                      type="text"
                                      value={integrationProvider.name}
                                      onInput={(event) => configureProviderInstance(providerConfigId, { name: event.currentTarget.value })}
                                      className="mt-2 w-full rounded-2xl border border-black/[0.06] bg-white/85 px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:border-signal-500/40 dark:border-white/[0.06] dark:bg-white/[0.06] dark:text-slate-100"
                                    />
                                  </label>
                                </div>
                                <div className="flex items-center gap-2">
                                  <label className="flex min-h-[46px] items-center gap-2 rounded-2xl border border-black/[0.06] bg-white/70 px-4 text-xs font-bold uppercase tracking-[0.14em] text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
                                    <input
                                      type="checkbox"
                                      checked={projectProvider?.enabled ?? true}
                                      onChange={(event) => configureProjectProvider(providerConfigId, { enabled: event.currentTarget.checked })}
                                    />
                                    Enabled
                                  </label>
                                  {providerEntries.length > 1 ? (
                                    <button
                                      type="button"
                                      onClick={() => removeProviderInstance(providerConfigId)}
                                      className="flex h-[46px] w-[46px] items-center justify-center rounded-2xl border border-status-red/20 bg-status-red/10 text-status-red"
                                      aria-label={`Remove ${integrationProvider.name}`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  ) : null}
                                </div>
                              </div>

                              <div className="mt-4">
                                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Authentication</div>
                                <div className="flex flex-wrap gap-2">
                                  {(providerId === "jules" ? [["API_KEY", "API key"]] : providerId === "qwen-code" ? [["LOCAL_AUTH", "Local auth"], ["API_KEY", "API key"], ["ALIBABA_CODING_PLAN", "Coding Plan"], ["CUSTOM_PROVIDER", "Custom endpoint"]] : providerId === "opencode" ? [["LOCAL_AUTH", "Local auth"], ["API_KEY", "Provider key"], ["CUSTOM_PROVIDER", "Custom endpoint"]] : [["LOCAL_AUTH", "Local auth"], ["API_KEY", "API key"]]).map(([mode, label]) => (
                                    <button
                                      key={mode}
                                      type="button"
                                      onClick={() => configureAuthMode(providerConfigId, mode as "LOCAL_AUTH" | "API_KEY" | "CUSTOM_PROVIDER" | "ALIBABA_CODING_PLAN")}
                                      className={`rounded-2xl border px-3 py-2 text-xs font-bold transition-colors ${authMode === mode ? "border-signal-500/30 bg-signal-500/12 text-signal-700 dark:text-signal-200" : "border-black/[0.06] bg-white/70 text-slate-500 hover:text-slate-800 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300"}`}
                                    >
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div className="mt-4 grid gap-3 md:grid-cols-2">
                                {showApiKey ? (
                                  <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                    API key
                                    <div className="mt-2 flex items-center gap-2 rounded-2xl border border-black/[0.06] bg-white/85 px-3 dark:border-white/[0.06] dark:bg-white/[0.06]">
                                      <KeyRound className="h-4 w-4 shrink-0 text-slate-400" />
                                      <input
                                        type="password"
                                        value={integrationProvider.apiKey}
                                        placeholder={providerId === "jules" ? "JULES_API_KEY" : "Paste provider key or leave empty for env/local auth"}
                                        onInput={(event) => configureProviderInstance(providerConfigId, { apiKey: event.currentTarget.value })}
                                        className="min-h-[46px] w-full bg-transparent font-mono text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
                                      />
                                    </div>
                                  </label>
                                ) : null}
                                {showLocalAuth ? (
                                  <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                    Auth path
                                    <input
                                      type="text"
                                      value={integrationProvider.authPath || readinessStatus?.authPath || ""}
                                      onInput={(event) => configureProviderInstance(providerConfigId, { authPath: event.currentTarget.value, mountAuth: true })}
                                      className="mt-2 min-h-[46px] w-full rounded-2xl border border-black/[0.06] bg-white/85 px-4 font-mono text-sm text-slate-800 outline-none focus:border-signal-500/40 dark:border-white/[0.06] dark:bg-white/[0.06] dark:text-slate-100"
                                    />
                                  </label>
                                ) : null}
                                {providerId === "qwen-code" && authMode === "ALIBABA_CODING_PLAN" ? (
                                  <ProviderTextField label="Coding Plan region" value={integrationProvider.qwenRegion || "international"} onInput={(value) => configureProviderInstance(providerConfigId, { qwenRegion: value === "china" ? "china" : "international" })} />
                                ) : null}
                                {providerId === "qwen-code" && authMode === "CUSTOM_PROVIDER" ? (
                                  <>
                                    <ProviderTextField label="Base URL" value={integrationProvider.qwenBaseUrl || ""} onInput={(value) => configureProviderInstance(providerConfigId, { qwenBaseUrl: value })} />
                                    <ProviderTextField label="Env key" value={integrationProvider.qwenEnvKey || "DASHSCOPE_API_KEY"} onInput={(value) => configureProviderInstance(providerConfigId, { qwenEnvKey: value })} />
                                  </>
                                ) : null}
                                {providerId === "opencode" && authMode === "CUSTOM_PROVIDER" ? (
                                  <>
                                    <ProviderTextField label="Provider id" value={integrationProvider.openCodeProviderId || "anthropic"} onInput={(value) => configureProviderInstance(providerConfigId, { openCodeProviderId: value })} />
                                    <ProviderTextField label="Model id" value={integrationProvider.openCodeModelId || "claude-sonnet-4-5"} onInput={(value) => configureProviderInstance(providerConfigId, { openCodeModelId: value })} />
                                    <ProviderTextField label="Base URL" value={integrationProvider.openCodeBaseUrl || ""} onInput={(value) => configureProviderInstance(providerConfigId, { openCodeBaseUrl: value })} />
                                    <ProviderTextField label="Env key" value={integrationProvider.openCodeEnvKey || "ANTHROPIC_API_KEY"} onInput={(value) => configureProviderInstance(providerConfigId, { openCodeEnvKey: value })} />
                                  </>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {active.id === "automation" && settings ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Choice title="Automation level" value={settings.defaults.automationLevel} options={[
                  ["ALWAYS_ASK", "Manual"],
                  ["SEMI_AUTO", "Semi-auto"],
                  ["FULL", "Full auto"],
                ]} onChange={(value) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, automationLevel: value as SystemSettings["defaults"]["automationLevel"] } }))} />
                <Choice title="Feature PR automerge" value={settings.defaults.ciIntelligence.featurePrAutoMergeMode} options={[
                  ["OFF", "Off"],
                  ["CREATE_PR", "Create PR"],
                  ["WHEN_GREEN", "When green"],
                  ["ALWAYS", "Always"],
                ]} onChange={(value) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, ciIntelligence: { ...current.defaults.ciIntelligence, featurePrAutoMergeMode: value as SystemSettings["defaults"]["ciIntelligence"]["featurePrAutoMergeMode"] } } }))} />
                <Choice title="Main PR automerge" value={settings.defaults.ciIntelligence.mainBranchAutoMergeMode} options={[
                  ["OFF", "Off"],
                  ["CREATE_PR", "Create PR"],
                  ["WHEN_GREEN", "When green"],
                  ["ALWAYS", "Always"],
                ]} onChange={(value) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, ciIntelligence: { ...current.defaults.ciIntelligence, mainBranchAutoMergeMode: value as SystemSettings["defaults"]["ciIntelligence"]["mainBranchAutoMergeMode"] } } }))} />
                <ToggleRow title="Auto-approve plans" description="Let planning continue without manual approval when the generated plan is available." checked={settings.defaults.automationInterventions.autoApprovePlan} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, automationInterventions: { ...current.defaults.automationInterventions, autoApprovePlan: checked } } }))} />
                <ToggleRow title="Memory system" description="Capture sprint and agent learnings for later retrieval." checked={settings.defaults.memory.enabled} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, memory: { ...current.defaults.memory, enabled: checked } } }))} />
                <ToggleRow title="Resolve main merge conflicts" description="Let a virtual worker attempt conflicts on the main branch merge gate before escalating." checked={settings.defaults.ciIntelligence.resolveMainMergeConflicts} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, ciIntelligence: { ...current.defaults.ciIntelligence, resolveMainMergeConflicts: checked } } }))} />
                <ToggleRow title="Resolve feature merge conflicts" description="Let a virtual worker resolve feature PR conflicts against the sprint branch when safe." checked={settings.defaults.ciIntelligence.resolveMergeConflicts} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, ciIntelligence: { ...current.defaults.ciIntelligence, resolveMergeConflicts: checked } } }))} />
                <ToggleRow title="Enable QA agent" description="Run quality-assurance reviews after task and sprint completion events." checked={settings.defaults.agents.qualityAssurance.enabled} onChange={(checked) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, agents: { ...current.defaults.agents, qualityAssurance: { ...current.defaults.agents.qualityAssurance, enabled: checked } } } }))} />
              </div>
            ) : null}

            {active.id === "appearance" && settings ? (
              <div className="space-y-5">
                <div className="grid gap-4 md:grid-cols-3">
                  <Choice title="Theme" value={settings.defaults.appearance.theme} options={[
                    ["SYSTEM", "System"],
                    ["LIGHT", "Light"],
                    ["DARK", "Dark"],
                  ]} onChange={(value) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, appearance: { ...current.defaults.appearance, theme: value as SystemSettings["defaults"]["appearance"]["theme"] } } }))} />
                  <Choice title="Motion" value={settings.defaults.appearance.reducedMotion} options={[
                    ["AUTO", "Auto"],
                    ["REDUCE", "Reduce"],
                    ["NONE", "None"],
                  ]} onChange={(value) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, appearance: { ...current.defaults.appearance, reducedMotion: value as SystemSettings["defaults"]["appearance"]["reducedMotion"] } } }))} />
                  <Choice title="Navigation" value={settings.defaults.appearance.navigationMode} options={[
                    ["DOCK", "Dock"],
                    ["SIDEBAR", "Sidebar"],
                  ]} onChange={(value) => updateSettings((current) => ({ ...current, defaults: { ...current.defaults, appearance: { ...current.defaults.appearance, navigationMode: value as SystemSettings["defaults"]["appearance"]["navigationMode"] } } }))} />
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {[
                    [FolderOpen, "Projects", "Add repositories from the project selector or the Projects page."],
                    [Compass, "Navbar", "Switch projects, select sprint scope, and route work to a virtual provider from the top bar."],
                    [Settings, "Settings", "All onboarding choices remain editable in Settings after this flow."],
                  ].map(([Icon, title, description]) => {
                    const MarkerIcon = Icon as typeof Settings;
                    return (
                      <div key={String(title)} className="rounded-3xl border border-black/[0.06] bg-white/75 p-5 dark:border-white/[0.06] dark:bg-white/[0.04]">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-signal-500/10 text-signal-600 dark:text-signal-300">
                          <MarkerIcon className="h-5 w-5" />
                        </div>
                        <div className="mt-4 text-sm font-black text-slate-900 dark:text-white">{String(title)}</div>
                        <div className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{String(description)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </main>

          <footer className="relative flex shrink-0 items-center justify-between gap-3 border-t border-black/[0.06] bg-white/45 px-5 py-4 backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-950/28 md:px-8">
            <button
              type="button"
              disabled={activeStep === 0}
              onClick={() => setActiveStep((step) => Math.max(0, step - 1))}
              className="inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-bold text-slate-500 transition-colors hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.06]"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <div className="flex items-center gap-2">
              {steps.map((step, index) => (
                <button
                  key={`dot-${step.id}`}
                  type="button"
                  aria-label={`Go to ${step.label}`}
                  onClick={() => setActiveStep(index)}
                  className={`h-2 rounded-full transition-all ${index === activeStep ? "w-8 bg-signal-500" : "w-2 bg-slate-300 dark:bg-slate-700"}`}
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
                onClick={() => setActiveStep((step) => Math.min(steps.length - 1, step + 1))}
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

const ProviderTextField: FunctionComponent<{
  label: string;
  value: string;
  onInput: (value: string) => void;
}> = ({ label, value, onInput }) => (
  <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
    {label}
    <input
      type="text"
      value={value}
      onInput={(event) => onInput(event.currentTarget.value)}
      className="mt-2 min-h-[46px] w-full rounded-2xl border border-black/[0.06] bg-white/85 px-4 font-mono text-sm text-slate-800 outline-none focus:border-signal-500/40 dark:border-white/[0.06] dark:bg-white/[0.06] dark:text-slate-100"
    />
  </label>
);
