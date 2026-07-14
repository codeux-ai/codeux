import { Circle, PlayCircle, CheckCircle2, AlertCircle } from "lucide-preact";
import type { TaskPriority, TaskStatus, Task } from "../types.js";
import type { DashboardLocale } from "../i18n/locales.js";
import { translateTask } from "../i18n/messages/tasks.js";

export const PRIORITY_CFG: Record<TaskPriority, { label: string; color: string; dot: string; bg: string }> = {
  critical: { label: "Critical", color: "text-status-red", dot: "bg-status-red shadow-[0_0_8px_rgba(227,0,15,0.6)]", bg: "bg-status-red/[0.08] border-status-red/20" },
  high: { label: "High", color: "text-ember-500", dot: "bg-ember-500 shadow-[0_0_8px_rgba(255,184,0,0.5)]", bg: "bg-ember-500/[0.08] border-ember-500/20" },
  medium: { label: "Medium", color: "text-signal-500", dot: "bg-signal-500 shadow-[0_0_6px_rgba(0,224,160,0.4)]", bg: "bg-signal-500/[0.06] border-signal-500/15" },
  low: { label: "Low", color: "text-slate-400", dot: "bg-slate-400", bg: "bg-slate-400/[0.06] border-slate-400/15" },
};

export const STATUS_CFG: Record<TaskStatus, { label: string; color: string; hex: string; icon: typeof Circle }> = {
  pending: { label: "Queued", color: "text-slate-400 dark:text-slate-500", hex: "#64748b", icon: Circle },
  in_progress: { label: "In Progress", color: "text-signal-500", hex: "#00E0A0", icon: PlayCircle as typeof Circle },
  coding_completed: { label: "Coding Completed", color: "text-cyan-500", hex: "#0F9FA8", icon: CheckCircle2 as typeof Circle },
  completed: { label: "Completed", color: "text-status-green", hex: "#00AB84", icon: CheckCircle2 as typeof Circle },
  QA_REVIEW_FAILED: { label: "QA Failed", color: "text-red-500", hex: "#ef4444", icon: AlertCircle as typeof Circle },
};

export const EXECUTOR_LABEL: Record<Task["executorType"], string> = {
  auto: "Auto",
  docker_cli: "CLI",
  jules: "Jules",
  mcp_worker: "Worker",
};

const STATUS_MESSAGE_KEY: Record<TaskStatus, "queued" | "inProgress" | "codingCompleted" | "completed" | "qaFailed"> = {
  pending: "queued",
  in_progress: "inProgress",
  coding_completed: "codingCompleted",
  completed: "completed",
  QA_REVIEW_FAILED: "qaFailed",
};

const PRIORITY_MESSAGE_KEY: Record<TaskPriority, "critical" | "high" | "medium" | "low"> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
};

export const getTaskStatusLabel = (status: TaskStatus, locale: DashboardLocale = "en"): string => (
  translateTask(locale, STATUS_MESSAGE_KEY[status])
);

export const getTaskPriorityLabel = (priority: TaskPriority, locale: DashboardLocale = "en"): string => (
  translateTask(locale, PRIORITY_MESSAGE_KEY[priority])
);

export const timeAgo = (iso: string) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};
