import { useMemo, useReducer } from "preact/hooks";
import {
  Box,
  ShieldCheck,
  Cpu,
  Settings,
  GitBranch,
  ClipboardList,
  Layers,
  Sparkles,
  Monitor,
  SlidersHorizontal,
} from "lucide-preact";
import type { DashboardExperienceMode, OnboardingRuntimeReadiness, ProviderId, SystemSettings } from "../../../types.js";
import { normalizeDashboardExperienceMode } from "../../lib/experience-mode.js";
import { getProviderInitialSelection } from "../../lib/onboarding-settings-draft.js";
import {
  translateOnboardingMessage,
  useOnboardingMessages,
  type OnboardingMessageKey,
} from "../../i18n/messages/onboarding.js";
import type { DashboardLocale } from "../../i18n/locales.js";

export type StepId = "mode" | "installation" | "introduction" | "providers" | "provider-setup" | "git" | "jira" | "defaults" | "automation" | "appearance";

const onboardingStepDefinitions: Array<{ id: StepId; labelKey: OnboardingMessageKey; icon: typeof Settings }> = [
  { id: "mode", labelKey: "stepSetupMode", icon: SlidersHorizontal },
  { id: "installation", labelKey: "stepInstallation", icon: Box },
  { id: "introduction", labelKey: "stepIntroduction", icon: ShieldCheck },
  { id: "providers", labelKey: "stepSelectProviders", icon: Cpu },
  { id: "provider-setup", labelKey: "stepProviders", icon: Settings },
  { id: "git", labelKey: "stepGit", icon: GitBranch },
  { id: "jira", labelKey: "stepJira", icon: ClipboardList },
  { id: "defaults", labelKey: "stepDefaultProviders", icon: Layers },
  { id: "automation", labelKey: "stepAutomation", icon: Sparkles },
  { id: "appearance", labelKey: "stepAppearance", icon: Monitor },
];

const easyOnboardingStepDefinitions: Array<{ id: StepId; labelKey: OnboardingMessageKey; icon: typeof Settings }> = [
  { id: "mode", labelKey: "stepSetupMode", icon: SlidersHorizontal },
  { id: "installation", labelKey: "stepInstallation", icon: Box },
  { id: "introduction", labelKey: "stepIntroduction", icon: ShieldCheck },
  { id: "provider-setup", labelKey: "stepProvider", icon: Cpu },
  { id: "git", labelKey: "stepGithub", icon: GitBranch },
];

const localizeSteps = (
  definitions: Array<{ id: StepId; labelKey: OnboardingMessageKey; icon: typeof Settings }>,
  locale: DashboardLocale,
): Array<{ id: StepId; label: string; icon: typeof Settings }> => definitions.map(({ labelKey, ...step }) => ({
  ...step,
  label: translateOnboardingMessage(locale, labelKey),
}));

export const onboardingSteps = localizeSteps(onboardingStepDefinitions, "en");
export const easyOnboardingSteps = localizeSteps(easyOnboardingStepDefinitions, "en");

export const getOnboardingStepsForMode = (
  mode: DashboardExperienceMode,
  locale: DashboardLocale = "en",
): Array<{ id: StepId; label: string; icon: typeof Settings }> => (
  localizeSteps(mode === "EASY" ? easyOnboardingStepDefinitions : onboardingStepDefinitions, locale)
);

export const getDefaultOnboardingReadiness = (locale: DashboardLocale = "en"): OnboardingRuntimeReadiness => ({
  checkedAt: "",
  cluster: {
    status: "not_ready",
    label: translateOnboardingMessage(locale, "checking"),
    detail: translateOnboardingMessage(locale, "runtimeChecksLoading"),
  },
  dependencies: [],
  providers: [],
  installers: {
    platform: "unsupported",
    recommendedMode: null,
    options: [],
  },
});

export const defaultOnboardingReadiness = getDefaultOnboardingReadiness();

export interface OnboardingFlowState {
  open: boolean;
  activeStep: number;
  lastStep: number;
  experienceMode: DashboardExperienceMode;
  readiness: OnboardingRuntimeReadiness;
  settings: SystemSettings | null;
  selectedProviders: ProviderId[];
  saving: boolean;
  error: string | null;
}

export type OnboardingFlowAction =
  | { type: "set-open"; open: boolean }
  | { type: "reset-and-open" }
  | { type: "close" }
  | { type: "set-active-step"; step: number }
  | { type: "go-next" }
  | { type: "go-previous" }
  | { type: "load-success"; readiness: OnboardingRuntimeReadiness; settings: SystemSettings }
  | { type: "load-failure"; error: string }
  | { type: "select-experience-mode"; mode: DashboardExperienceMode }
  | { type: "update-settings"; recipe: (current: SystemSettings) => SystemSettings }
  | { type: "set-settings"; settings: SystemSettings }
  | { type: "select-provider"; provider: ProviderId }
  | { type: "set-selected-providers"; providers: ProviderId[] }
  | { type: "deselect-provider"; provider: ProviderId }
  | { type: "toggle-provider"; provider: ProviderId }
  | { type: "set-saving"; saving: boolean }
  | { type: "set-error"; error: string | null };

const clampStep = (step: number, mode: DashboardExperienceMode): number => (
  Math.min(getOnboardingStepsForMode(mode).length - 1, Math.max(0, step))
);

export const createInitialOnboardingFlowState = (locale: DashboardLocale = "en"): OnboardingFlowState => ({
  open: false,
  activeStep: 0,
  lastStep: 0,
  experienceMode: "EXPERT",
  readiness: getDefaultOnboardingReadiness(locale),
  settings: null,
  selectedProviders: [],
  saving: false,
  error: null,
});

export const cloneSystemSettings = (settings: SystemSettings): SystemSettings => structuredClone(settings) as SystemSettings;

export const onboardingFlowReducer = (
  state: OnboardingFlowState,
  action: OnboardingFlowAction,
): OnboardingFlowState => {
  switch (action.type) {
    case "set-open":
      return { ...state, open: action.open };
    case "reset-and-open":
      return { ...state, open: true, activeStep: 0, lastStep: state.activeStep };
    case "close":
      return { ...state, open: false };
    case "set-active-step":
      return { ...state, lastStep: state.activeStep, activeStep: clampStep(action.step, state.experienceMode) };
    case "go-next":
      return { ...state, lastStep: state.activeStep, activeStep: clampStep(state.activeStep + 1, state.experienceMode) };
    case "go-previous":
      return { ...state, lastStep: state.activeStep, activeStep: clampStep(state.activeStep - 1, state.experienceMode) };
    case "load-success":
      const loadedMode = normalizeDashboardExperienceMode(action.settings.defaults.appearance.experienceMode);
      return {
        ...state,
        experienceMode: state.settings ? state.experienceMode : loadedMode,
        activeStep: clampStep(state.activeStep, state.settings ? state.experienceMode : loadedMode),
        readiness: action.readiness,
        settings: action.settings,
        selectedProviders: state.selectedProviders.length > 0
          ? state.selectedProviders
          : getProviderInitialSelection(action.readiness.providers, action.settings),
        error: null,
      };
    case "load-failure":
      return { ...state, error: action.error };
    case "select-experience-mode":
      return {
        ...state,
        experienceMode: action.mode,
        activeStep: clampStep(state.activeStep, action.mode),
      };
    case "update-settings":
      return {
        ...state,
        settings: state.settings ? action.recipe(cloneSystemSettings(state.settings)) : state.settings,
      };
    case "set-settings":
      return { ...state, settings: action.settings };
    case "select-provider":
      return state.selectedProviders.includes(action.provider)
        ? state
        : { ...state, selectedProviders: [...state.selectedProviders, action.provider] };
    case "set-selected-providers":
      return { ...state, selectedProviders: Array.from(new Set(action.providers)) };
    case "deselect-provider":
      return { ...state, selectedProviders: state.selectedProviders.filter((provider) => provider !== action.provider) };
    case "toggle-provider":
      return state.selectedProviders.includes(action.provider)
        ? { ...state, selectedProviders: state.selectedProviders.filter((provider) => provider !== action.provider) }
        : { ...state, selectedProviders: [...state.selectedProviders, action.provider] };
    case "set-saving":
      return { ...state, saving: action.saving };
    case "set-error":
      return { ...state, error: action.error };
    default:
      return state;
  }
};

export function useOnboardingStepFlow() {
  const { locale } = useOnboardingMessages();
  const [state, dispatch] = useReducer(onboardingFlowReducer, locale, createInitialOnboardingFlowState);

  const steps = useMemo(() => getOnboardingStepsForMode(state.experienceMode, locale), [locale, state.experienceMode]);
  const activeStepData = steps[state.activeStep] ?? steps[0]!;
  const selectedProviderTypes = useMemo(
    () => onboardingProviderTypes.filter((provider) => state.selectedProviders.includes(provider)),
    [state.selectedProviders],
  );

  const setActiveStep = (step: number) => dispatch({ type: "set-active-step", step });
  const goToNextStep = () => dispatch({ type: "go-next" });
  const goToPreviousStep = () => dispatch({ type: "go-previous" });
  const resetSteps = () => dispatch({ type: "set-active-step", step: 0 });
  const updateSettings = (recipe: (current: SystemSettings) => SystemSettings) => dispatch({ type: "update-settings", recipe });

  return {
    ...state,
    dispatch,
    activeStep: state.activeStep,
    setActiveStep,
    activeStepData,
    selectedProviderTypes,
    goToNextStep,
    goToPreviousStep,
    resetSteps,
    steps,
    updateSettings,
  };
}

export const onboardingProviderTypes: ProviderId[] = ["jules", "gemini", "antigravity", "codex", "claude-code", "qwen-code", "opencode"];
