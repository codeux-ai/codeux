import type { ComponentType } from "preact";
import { Sparkles, UserCircle2, Bot, Brain, Cog, Terminal } from "lucide-preact";

export type ChatRole = "user" | "assistant" | "system" | "tool" | "dashboard_user" | "connection";

export interface ChatIdentityProps {
  role: ChatRole;
  providerId?: string;
  isVirtual?: boolean;
  isJules?: boolean;
  isCli?: boolean;
}

export interface AppearanceConfig {
  icon: ComponentType<any> | "jules" | "boat";
  bgClass: string;
  textClass: string;
  borderClass: string;
  label: string;
}

export function resolveIdentityAppearance(props: ChatIdentityProps): AppearanceConfig {
  const { role, providerId, isVirtual, isJules, isCli } = props;

  if (role === "user" || role === "dashboard_user" || role === "tool") {
    return {
      icon: UserCircle2,
      bgClass: "bg-white dark:bg-void-700",
      textClass: "text-slate-500 dark:text-slate-300",
      borderClass: "border-black/[0.06] dark:border-white/[0.06]",
      label: role === "dashboard_user" ? "You" : role === "tool" ? "Tool" : "User",
    };
  }

  if (role === "system") {
    return {
      icon: Cog,
      bgClass: "bg-slate-100 dark:bg-void-800",
      textClass: "text-slate-500 dark:text-slate-400",
      borderClass: "border-black/[0.06] dark:border-white/[0.06]",
      label: "System",
    };
  }

  // Assistant / Connection
  if (isJules) {
    return {
      icon: "jules",
      bgClass: "bg-signal-500/10",
      textClass: "text-signal-500",
      borderClass: "border-signal-500/20",
      label: "Jules",
    };
  }

  if (isCli) {
    return {
      icon: "boat",
      bgClass: "bg-blue-500/10",
      textClass: "text-blue-500",
      borderClass: "border-blue-500/20",
      label: providerId || "CLI Worker",
    };
  }

  if (isVirtual) {
    return {
      icon: Brain,
      bgClass: "bg-purple-500/10",
      textClass: "text-purple-500",
      borderClass: "border-purple-500/20",
      label: providerId || "Virtual Worker",
    };
  }

  // Default Agent/Connection
  return {
    icon: Sparkles,
    bgClass: "bg-signal-500/10",
    textClass: "text-signal-500",
    borderClass: "border-signal-500/20",
    label: providerId || "Assistant",
  };
}

export function getWidgetAppearance(status: "planning" | "waiting" | "compaction" | "transition") {
  switch (status) {
    case "planning":
      return { text: "Thinking...", icon: Brain, colorClass: "text-purple-500" };
    case "waiting":
      return { text: "Waiting for reply...", icon: Sparkles, colorClass: "text-signal-500" };
    case "compaction":
      return { text: "Compacting memory...", icon: Cog, colorClass: "text-slate-500" };
    case "transition":
      return { text: "Changing route...", icon: Terminal, colorClass: "text-blue-500" };
    default:
      return { text: "Working...", icon: Sparkles, colorClass: "text-signal-500" };
  }
}
