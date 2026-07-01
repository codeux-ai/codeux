import { useState } from "preact/hooks";
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
} from "lucide-preact";

export type StepId = "installation" | "introduction" | "providers" | "provider-setup" | "git" | "jira" | "defaults" | "automation" | "appearance";

export const onboardingSteps: Array<{ id: StepId; label: string; icon: typeof Settings }> = [
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

export function useOnboardingStepFlow() {
  const [activeStep, setActiveStep] = useState(0);

  const activeStepData = onboardingSteps[activeStep] ?? onboardingSteps[0]!;

  const goToNextStep = () => setActiveStep((step) => Math.min(onboardingSteps.length - 1, step + 1));
  const goToPreviousStep = () => setActiveStep((step) => Math.max(0, step - 1));
  const resetSteps = () => setActiveStep(0);

  return {
    activeStep,
    setActiveStep,
    activeStepData,
    goToNextStep,
    goToPreviousStep,
    resetSteps,
    steps: onboardingSteps,
  };
}