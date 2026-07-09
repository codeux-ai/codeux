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

export type StepId = "mode" | "installation" | "introduction" | "providers" | "provider-setup" | "git" | "jira" | "defaults" | "automation" | "appearance";

export const onboardingSteps: Array<{ id: StepId; label: string; icon: typeof Settings }> = [
  { id: "mode", label: "Setup mode", icon: SlidersHorizontal },
  { id: "installation", label: "Installation", icon: Box },
  { id: "introduction", label: "Introduction", icon: ShieldCheck },
  { id: "providers", label: "Select Providers", icon: Cpu },
  { id: "provider-setup", label: "Providers", icon: Settings },
  { id: "git", label: "Git", icon: GitBranch },
  { id: "jira", label: "Jira", icon: ClipboardList },
  { id: "defaults", label: "Default providers", icon: Layers },
  { id: "automation", label: "Automation", icon: Sparkles },
  { id: "appearance", label: "Appearance", icon: Monitor },
];

export const easyOnboardingSteps: Array<{ id: StepId; label: string; icon: typeof Settings }> = [
  { id: "mode", label: "Setup mode", icon: SlidersHorizontal },
  { id: "provider-setup", label: "Provider", icon: Cpu },
  { id: "git", label: "GitHub", icon: GitBranch },
];

export const getOnboardingStepsForMode = (
  mode: DashboardExperienceMode,
): Array<{ id: StepId; label: string; icon: typeof Settings }> => (
  mode === "EASY" ? easyOnboardingSteps : onboardingSteps
);

export const defaultOnboardingReadiness: OnboardingRuntimeReadiness = {
  checkedAt: "",
  cluster: {
    status: "not_ready",
    label: "Checking",
    detail: "Runtime checks are loading.",
  },
  dependencies: [],
  providers: [],
  installers: {
    platform: "unsupported",
    recommendedMode: null,
    options: [],
  },
};

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

export const createInitialOnboardingFlowState = (): OnboardingFlowState => ({
  open: false,
  activeStep: 0,
  lastStep: 0,
  experienceMode: "EXPERT",
  readiness: defaultOnboardingReadiness,
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
  const [state, dispatch] = useReducer(onboardingFlowReducer, undefined, createInitialOnboardingFlowState);

  const steps = useMemo(() => getOnboardingStepsForMode(state.experienceMode), [state.experienceMode]);
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
