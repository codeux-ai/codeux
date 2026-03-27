import {
    Activity,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    Clock,
    PauseCircle,
} from "lucide-preact";
import type { ExecutionRuntimeEventSummary } from "../../types.js";

export const TASK_STATUS_CFG = {
    RUNNING:   { label: "Running",   hex: "#00E0A0", dot: "bg-status-green shadow-[0_0_10px_rgba(0,171,132,0.7)] animate-pulse", text: "text-signal-500",  bg: "bg-signal-500/8",  border: "border-signal-500/20", icon: Activity },
    CODING_COMPLETED: { label: "Coding Completed", hex: "#0F9FA8", dot: "bg-cyan-500 shadow-[0_0_8px_rgba(15,159,168,0.45)]", text: "text-cyan-500", bg: "bg-cyan-500/8", border: "border-cyan-500/20", icon: CheckCircle2 },
    COMPLETED: { label: "Completed", hex: "#00AB84", dot: "bg-status-green shadow-[0_0_8px_rgba(0,171,132,0.5)]",                text: "text-status-green", bg: "bg-status-green/8", border: "border-status-green/20", icon: CheckCircle2 },
    FAILED:    { label: "Failed",    hex: "#E3000F", dot: "bg-status-red shadow-[0_0_10px_rgba(227,0,15,0.7)]",                  text: "text-status-red",   bg: "bg-status-red/8",   border: "border-status-red/20", icon: XCircle },
    BLOCKED:   { label: "Blocked",   hex: "#F59E0B", dot: "bg-status-amber shadow-[0_0_8px_rgba(245,158,11,0.5)]",               text: "text-status-amber", bg: "bg-status-amber/8", border: "border-status-amber/20", icon: AlertTriangle },
    PENDING:   { label: "Pending",   hex: "#64748b", dot: "bg-slate-400 dark:bg-slate-600",                                      text: "text-slate-400",    bg: "bg-slate-500/8",    border: "border-slate-500/20", icon: Clock },
    QUOTA:     { label: "Quota",     hex: "#F59E0B", dot: "bg-status-amber shadow-[0_0_8px_rgba(245,158,11,0.5)] animate-pulse",  text: "text-status-amber", bg: "bg-status-amber/8", border: "border-status-amber/20", icon: PauseCircle },
} as const;

export type TaskStatusKey = keyof typeof TASK_STATUS_CFG;

export const getTaskCfg = (status?: string) => TASK_STATUS_CFG[(status as TaskStatusKey) ?? "PENDING"] ?? TASK_STATUS_CFG.PENDING;

export const MERGE_INDICATOR_CFG: Record<string, { label: string; text: string; bg: string; border: string }> = {
    CI:            { label: "CI",            text: "text-signal-400",     bg: "bg-signal-500/8",      border: "border-signal-500/15" },
    AUTOMERGE:     { label: "Automerge",     text: "text-ember-400",      bg: "bg-ember-500/8",       border: "border-ember-500/15" },
    MERGED:        { label: "Merged",        text: "text-status-green",   bg: "bg-status-green/8",    border: "border-status-green/15" },
    MERGE_BLOCKED: { label: "Merge Blocked", text: "text-status-amber",   bg: "bg-status-amber/8",    border: "border-status-amber/15" },
    MERGE_CONFLICT:{ label: "Merge Conflict",text: "text-status-red",     bg: "bg-status-red/8",      border: "border-status-red/15" },
};

export const ORIGINATOR_CFG: Record<string, { border: string; text: string; label: string }> = {
    agent:    { border: "border-signal-500/30", text: "text-signal-400", label: "Agent" },
    user:     { border: "border-ember-500/30",  text: "text-ember-400",  label: "User" },
    provider: { border: "border-status-amber/30", text: "text-status-amber", label: "Provider" },
    system:   { border: "border-white/[0.06]",  text: "text-slate-500",  label: "System" },
};

export const getOriginatorCfg = (originator?: string) => {
    const key = (originator || "system").toLowerCase();
    return ORIGINATOR_CFG[key] ?? ORIGINATOR_CFG.system;
};

export const EMPTY_RUNTIME_STATS = {
    total: 0,
    running: 0,
    codingCompleted: 0,
    completed: 0,
    failed: 0,
    ci: 0,
    automerge: 0,
    merged: 0,
    mergeBlocked: 0,
    mergeConflicts: 0,
};

const getProviderActivityText = (payload: Record<string, unknown>): string => {
    const agentMessage = typeof (payload.agentMessaged as { agentMessage?: unknown } | null | undefined)?.agentMessage === "string"
        ? (payload.agentMessaged as { agentMessage: string }).agentMessage
        : null;
    if (agentMessage) {
        return agentMessage;
    }

    const userMessage = typeof (payload.userMessaged as { userMessage?: unknown } | null | undefined)?.userMessage === "string"
        ? (payload.userMessaged as { userMessage: string }).userMessage
        : null;
    if (userMessage) {
        return userMessage;
    }

    const progressUpdated = payload.progressUpdated as { title?: unknown; description?: unknown } | null | undefined;
    if (typeof progressUpdated?.title === "string" && progressUpdated.title.trim().length > 0) {
        return progressUpdated.title;
    }
    if (typeof progressUpdated?.description === "string" && progressUpdated.description.trim().length > 0) {
        return progressUpdated.description;
    }

    if (typeof payload.preview === "string" && payload.preview.trim().length > 0) {
        return payload.preview;
    }
    if (typeof payload.description === "string" && payload.description.trim().length > 0) {
        return payload.description;
    }

    return "Provider activity";
};

export const getExecutionEventText = (event: ExecutionRuntimeEventSummary): string => {
    const payload = event.payload || {};

    switch (event.eventType) {
        case "dispatch_queued":
            return `Queued for ${String(payload.executorType || event.provider || "execution")}`;
        case "dispatch_started":
            return `Started ${String(payload.executorType || event.provider || "execution")} dispatch`;
        case "session_created":
            return `Session created ${String(payload.sessionId || event.sessionId || "")}`.trim();
        case "worker_claimed":
            return `Claimed by ${String(payload.connectionKey || event.connectionDisplayName || "worker")}`;
        case "run_running":
            return String(payload.summaryMarkdown || "Worker heartbeat received");
        case "run_completed":
            return String(payload.summaryMarkdown || "Run completed");
        case "run_failed":
            return String(payload.errorMessage || payload.summaryMarkdown || "Run failed");
        case "run_blocked":
            return String(payload.errorMessage || payload.summaryMarkdown || "Run blocked");
        case "session_state_synced":
            return `Session ${String(payload.sessionState || event.taskRunState || "updated").toLowerCase()}`;
        case "provider_activity":
            return getProviderActivityText(payload);
        case "dispatch_failed":
            return String(payload.error || "Dispatch failed");
        case "cli_prepare_started":
            return `Preparing ${String(payload.workerBranch || "workspace")}`;
        case "cli_prepare_completed":
            return `Workspace ready ${String(payload.worktreePath || "")}`.trim();
        case "cli_provider_started":
            return `Running ${String(payload.provider || event.provider || "provider")} in workspace`;
        case "cli_provider_completed":
            return `${String(payload.provider || event.provider || "provider")} stage completed`;
        case "cli_git_no_changes":
            return "No file changes produced";
        case "cli_git_pushed":
            return `Pushed ${String(payload.pushedBranch || event.workerBranch || "worker branch")} to origin`;
        case "cli_pr_finalized":
            return payload.prUrl ? `Feature PR ready ${String(payload.prUrl)}` : "Workflow completed without PR";
        case "cli_workflow_completed":
            return payload.outcome === "no_changes" ? "Workflow completed with no changes" : "Workflow completed";
        case "cli_workflow_failed":
            return String(payload.errorMessage || "CLI workflow failed");
        case "cli_worktree_cleaned":
            return `Removed worktree ${String(payload.worktreePath || "")}`.trim();
        case "cli_worktree_preserved":
            return `Preserved worktree ${String(payload.worktreePath || "")}`.trim();
        case "ci_gate_status":
            return `CI gate ${String(payload.state || "updated").replace(/_/g, " ")}`;
        case "action_required_manual_intervention":
            return `${String(payload.owner || "Manual")} intervention required${payload.reason ? `: ${String(payload.reason)}` : ""}`;
        case "action_required_auto_approved":
            return "Auto-approved session plan";
        case "action_required_auto_replied":
            return "Auto-answered clarification request";
        case "action_required_auto_resumed":
            return "Auto-resumed paused session";
        case "action_required_auto_failed":
            return String(payload.reason || "Auto-intervention failed");
        case "protocol_merge_required":
            return "Task completed and is awaiting merge";
        case "protocol_action_required":
            return `${String(payload.owner || "Manual")} action required${payload.interventionHint ? `: ${String(payload.interventionHint)}` : ""}`;
        case "watch_loop_started":
            return `Watch loop started for sprint ${String(payload.sprintNumber || "")}`.trim();
        case "branch_preflight_blocked":
            return `Branch preflight blocked for ${String(payload.featureBranch || "feature branch")}`;
        case "planning_preflight_blocked":
            return `Planning required before orchestration for ${String(payload.planningTarget || "selected sprint")}`;
        case "sprint_merge_required":
            return `Sprint paused for manual merge (${String(payload.awaitingMergeCount || 0)} task${Number(payload.awaitingMergeCount || 0) === 1 ? "" : "s"})`;
        case "sprint_no_more_actions":
            return "Sprint paused because no more executable work was available";
        case "sprint_completed":
            return "Sprint execution completed";
        case "sprint_failed":
            return `Sprint execution failed (${String(payload.failedTaskCount || 0)} failed task${Number(payload.failedTaskCount || 0) === 1 ? "" : "s"})`;
        case "sprint_paused":
            return `Sprint paused: ${String(payload.reason || "manual attention").replace(/_/g, " ")}`;
        case "sprint_cancelled":
            return `Sprint cancelled: ${String(payload.reason || "empty").replace(/_/g, " ")}`;
        case "main_merge_gate_status":
            return `Main merge gate ${String(payload.state || "updated").replace(/_/g, " ")}`;
        case "sprint_pause_requested":
            return "Dashboard requested a sprint pause";
        case "sprint_cancel_requested":
            return "Dashboard requested sprint cancellation";
        case "dispatch_cancel_requested":
            return String(payload.reason || "Dashboard requested dispatch cancellation");
        case "cli_workflow_cancel_requested":
            return "CLI workflow received a cancellation request";
        case "cli_workflow_cancelled":
            return "CLI workflow stopped due to dashboard cancellation";
        case "jules_stop_requested":
            return "Sent a stop request to the Jules session";
        case "jules_stop_request_failed":
            return String(payload.errorMessage || "Could not send stop request to Jules");
        case "worker_cancel_pending":
            return "Worker acknowledged cancellation request and is stopping";
        case "worker_cancelled":
            return "Worker dispatch cancelled";
        case "dispatch_cancelled":
            return String(payload.reason || "Dispatch cancelled from dashboard");
        case "dispatch_retry_requested":
            return "Dashboard requested a dispatch retry";
        default:
            return event.eventType.replace(/_/g, " ");
    }
};
