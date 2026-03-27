export type ChatIdentityRole =
  | "user"
  | "system"
  | "jules"
  | "virtual"
  | "worker"
  | "agent"
  | "unknown";

export type ChatActivityState =
  | "planning"
  | "waiting"
  | "compacting"
  | "transitioning"
  | "idle";

export interface IdentityAppearance {
  role: ChatIdentityRole;
  label: string;
  colorClass: string;
  borderClass: string;
  bgClass: string;
  textClass: string;
  gradientFrom: string;
  gradientTo: string;
}

export function resolveChatRole(
  options: {
    provider?: string | null;
    model?: string | null;
    roleStr?: string | null;
    isTool?: boolean;
    transport?: string | null;
  }
): ChatIdentityRole {
  const { provider, roleStr, isTool, transport } = options;

  if (roleStr === "user") return "user";
  if (roleStr === "system") return "system";
  if (isTool) return "system";

  const p = (provider || "").toLowerCase();
  const t = (transport || "").toLowerCase();

  if (p === "jules" || p === "external") return "jules";
  if (t === "mcp") return "worker";
  if (p === "container" || t === "stdio") return "virtual";
  if (p === "agent") return "agent";

  return "jules";
}

export function getAvatarStyles(role: ChatIdentityRole): IdentityAppearance {
  switch (role) {
    case "user":
      return {
        role,
        label: "User",
        colorClass: "text-slate-500 dark:text-slate-300",
        borderClass: "border-black/[0.06] dark:border-white/[0.06]",
        bgClass: "bg-white dark:bg-void-700",
        textClass: "text-slate-500 dark:text-slate-300",
        gradientFrom: "from-slate-100 dark:from-slate-700",
        gradientTo: "to-slate-200 dark:to-slate-800",
      };
    case "system":
      return {
        role,
        label: "System",
        colorClass: "text-slate-500 dark:text-slate-400",
        borderClass: "border-black/[0.06] dark:border-white/[0.06]",
        bgClass: "bg-black/[0.03] dark:bg-white/[0.03]",
        textClass: "text-slate-600 dark:text-slate-400",
        gradientFrom: "from-slate-100 dark:from-slate-700/50",
        gradientTo: "to-slate-200 dark:to-slate-800/50",
      };
    case "jules":
      return {
        role,
        label: "Jules",
        colorClass: "text-signal-500",
        borderClass: "border-signal-500/20",
        bgClass: "bg-signal-500/10",
        textClass: "text-signal-600 dark:text-signal-400",
        gradientFrom: "from-signal-500",
        gradientTo: "to-amber-500",
      };
    case "virtual":
      return {
        role,
        label: "Virtual Worker",
        colorClass: "text-cyan-500",
        borderClass: "border-cyan-500/20",
        bgClass: "bg-cyan-500/10",
        textClass: "text-cyan-600 dark:text-cyan-400",
        gradientFrom: "from-cyan-500",
        gradientTo: "to-blue-500",
      };
    case "worker":
      return {
        role,
        label: "Worker",
        colorClass: "text-indigo-500",
        borderClass: "border-indigo-500/20",
        bgClass: "bg-indigo-500/10",
        textClass: "text-indigo-600 dark:text-indigo-400",
        gradientFrom: "from-indigo-500",
        gradientTo: "to-purple-500",
      };
    case "agent":
      return {
        role,
        label: "Agent",
        colorClass: "text-emerald-500",
        borderClass: "border-emerald-500/20",
        bgClass: "bg-emerald-500/10",
        textClass: "text-emerald-600 dark:text-emerald-400",
        gradientFrom: "from-emerald-500",
        gradientTo: "to-teal-500",
      };
    case "unknown":
    default:
      return {
        role: "unknown",
        label: "Unknown",
        colorClass: "text-slate-400",
        borderClass: "border-black/[0.06] dark:border-white/[0.06]",
        bgClass: "bg-black/[0.03] dark:bg-white/[0.03]",
        textClass: "text-slate-500",
        gradientFrom: "from-slate-200 dark:from-slate-700",
        gradientTo: "to-slate-300 dark:to-slate-800",
      };
  }
}
