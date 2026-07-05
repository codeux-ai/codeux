import type { FunctionComponent } from "preact";
import { useMemo, useState, useEffect } from "preact/hooks";
import { AlertTriangle, GitBranch, Loader2, RotateCcw, Trash2, X } from "lucide-preact";
import { useActionFeedback } from "../../hooks/use-action-feedback.js";
import type { Subtask, SystemSettings } from "../../../types.js";
import { AvantgardeSelect } from "./AvantgardeSelect.js";
import { fetchSystemSettings } from "../../lib/settings-api.js";
import {
    getProviderInstanceLabel,
    getProviderInstanceModelOptions,
    getSystemIntegrationProviders,
    providerSupportsModelSelection,
} from "../../lib/settings-view-models.js";
import { ProviderBrandIcon } from "../providers/ProviderBrandIcon.js";
import { ActionFeedbackRegion } from "./ActionFeedbackRegion.js";
import { Modal } from "./Modal.js";

interface RerunTaskModalProps {
    task: Subtask;
    allTasks: Subtask[];
    currentProvider?: string | null;
    onClose: () => void;
    onConfirm: (options: { provider?: string; providerConfigId?: string; model?: string; clearWorktree: boolean; resetDependents: boolean; undoMerge: boolean }) => void | Promise<void>;
}

const MERGED_TASK_INDICATORS = new Set(["MERGED", "AUTOMERGE"]);
const DOWNSTREAM_RESET_PROMPT_STATUSES = new Set(["RUNNING", "CODING_COMPLETED", "COMPLETED", "FAILED"]);

export const RerunTaskModal: FunctionComponent<RerunTaskModalProps> = ({
    task,
    allTasks,
    currentProvider,
    onClose,
    onConfirm,
}) => {
    const [providerConfigId, setProviderConfigId] = useState("");
    const [clearWorktree, setClearWorktree] = useState(false);
    const [resetDependents, setResetDependents] = useState(false);
    const [undoMerge, setUndoMerge] = useState(Boolean(task.is_merged) || MERGED_TASK_INDICATORS.has(task.merge_indicator || ""));
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
    const [settingsLoaded, setSettingsLoaded] = useState(false);
    const { feedback, setPending, setSuccess, setError, clearFeedback, clearError } = useActionFeedback();

    useEffect(() => {
        let active = true;
        fetchSystemSettings()
            .then((settings) => {
                if (!active) return;
                setSystemSettings(settings);
                setSettingsLoaded(true);
            })
            .catch(() => {
                if (!active) return;
                setSettingsLoaded(true);
            });
        return () => {
            active = false;
        };
    }, []);

    const providerOptions = useMemo(() => {
        const base = [{ value: "", label: "Auto (use current setting)" }];
        if (!systemSettings) {
            return base;
        }

        const available = Object.entries(getSystemIntegrationProviders(systemSettings))
            .filter(([, p]) => p.provider === "jules" || p.apiKey.trim().length > 0 || p.mountAuth || p.authType === "dashboardAuth")
            .map(([id, p]) => ({
                value: id,
                label: getProviderInstanceLabel(p),
                icon: () => <ProviderBrandIcon id={p.provider} className="h-7 w-7 rounded-[0.7rem]" imageClassName="h-4 w-4" />,
            }));

        return [...base, ...available];
    }, [systemSettings]);

    const [model, setModel] = useState("");
    const selectedProvider = useMemo(() => (
        providerConfigId && systemSettings
            ? getSystemIntegrationProviders(systemSettings)[providerConfigId]
            : undefined
    ), [providerConfigId, systemSettings]);

    useEffect(() => {
        if (!selectedProvider || selectedProvider.provider === "jules") {
            setModel("");
        }
    }, [selectedProvider]);

    const showModelOverride = Boolean(selectedProvider && providerSupportsModelSelection(selectedProvider.provider));
    const modelOptions = useMemo(() => {
        if (!showModelOverride || !systemSettings || !selectedProvider) {
            return [];
        }
        const projectProvider = systemSettings.defaults.aiProvider.providers[providerConfigId] || {
            provider: selectedProvider.provider,
            model: "default",
        };
        return getProviderInstanceModelOptions(providerConfigId, projectProvider, systemSettings);
    }, [providerConfigId, selectedProvider, showModelOverride, systemSettings]);

    const downstreamTasks = useMemo(() => {
        const byId = new Map(allTasks.map(candidate => [candidate.id, candidate]));
        const visited = new Set<string>();
        const queue = allTasks
            .filter(candidate => candidate.depends_on.includes(task.id))
            .map(candidate => candidate.id);
        const result: Subtask[] = [];

        while (queue.length > 0) {
            const currentId = queue.shift();
            if (!currentId || visited.has(currentId)) {
                continue;
            }
            visited.add(currentId);
            const currentTask = byId.get(currentId);
            if (!currentTask) {
                continue;
            }
            result.push(currentTask);
            for (const candidate of allTasks) {
                if (!visited.has(candidate.id) && candidate.depends_on.includes(currentId)) {
                    queue.push(candidate.id);
                }
            }
        }

        return result;
    }, [allTasks, task.id]);

    const downstreamPromptTasks = useMemo(
        () => downstreamTasks.filter(candidate => DOWNSTREAM_RESET_PROMPT_STATUSES.has(candidate.status || "PENDING")),
        [downstreamTasks],
    );
    const mergedTaskCount = useMemo(() => (
        [task, ...downstreamTasks].filter(candidate => (
            Boolean(candidate.is_merged) || MERGED_TASK_INDICATORS.has(candidate.merge_indicator || "")
        )).length
    ), [downstreamTasks, task]);
    const taskAlreadyMerged = Boolean(task.is_merged) || MERGED_TASK_INDICATORS.has(task.merge_indicator || "");


    const handleClose = () => {
        if (isSubmitting) return;
        onClose();
    };


    const handleSubmit = async () => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        setPending("Preparing task rerun...");
        try {
            await onConfirm({
                provider: selectedProvider?.provider,
                providerConfigId: providerConfigId || undefined,
                model: model || undefined,
                clearWorktree,
                resetDependents,
                undoMerge: taskAlreadyMerged && undoMerge,
            });
            setIsSubmitting(false);
            setSuccess("Task rerun started.", { autoDismiss: false });
            window.setTimeout(() => onClose(), 700);
        } catch (err) {
            setIsSubmitting(false);
            const message = err instanceof Error ? err.message : String(err);
            setError(message || "Failed to rerun task.", { retryAction: handleSubmit, retryLabel: "Retry", autoDismiss: false });
        }
    };

    const optionCardClass = (selected: boolean, tone: "amber" | "red" = "amber") => {
        const selectedClass = tone === "red"
            ? "border-status-red/40 bg-status-red/10 text-status-red"
            : "border-status-amber/45 bg-status-amber/10 text-status-amber";
        const idleClass = "border-black/[0.08] bg-black/[0.02] text-slate-600 hover:border-status-amber/30 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300";
        return `group flex items-start gap-3 rounded-2xl border px-4 py-3 transition-all focus-within:ring-2 focus-within:ring-status-amber cursor-pointer has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55 ${selected ? selectedClass : idleClass}`;
    };

    return (
        <Modal
            isOpen={true}
            onClose={handleClose}
            ariaLabelledBy="rerun-modal-title"
            className="w-[calc(100vw-2rem)] sm:w-full max-w-md !p-0 !rounded-[2rem]"
        >
            <div
                className="w-full cursor-default overflow-hidden bg-white dark:bg-void-900"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-7 pt-6 pb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-status-amber/10">
                            <RotateCcw className="w-4 h-4 text-status-amber" strokeWidth={2} />
                        </div>
                        <div>
                            <h2 id="rerun-modal-title" className="text-base font-bold text-slate-900 dark:text-white">
                                Rerun Task
                            </h2>
                            <p className="text-[11px] text-slate-400 font-mono">#{task.id}</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleClose}
                        aria-label="Close dialog"
                        disabled={isSubmitting}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.04] text-slate-400 hover:text-slate-700 dark:bg-white/[0.04] dark:text-slate-500 dark:hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-status-amber"
                    >
                        <X aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={2} />
                    </button>
                </div>

                {/* Body */}
                <div className="px-7 pb-6 space-y-5">
                    <ActionFeedbackRegion
                        status={feedback.status}
                        message={feedback.message}
                        onDismiss={clearFeedback}
                        clearError={clearError}
                        autoDismiss={feedback.autoDismiss}
                        retryAction={feedback.retryAction}
                        retryLabel={feedback.retryLabel}
                    />

                    <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        This will reset <span className="font-semibold text-slate-700 dark:text-slate-200">{task.title}</span> and start a fresh execution.
                    </p>

                    {taskAlreadyMerged && (
                        <div className="rounded-2xl border border-status-red/20 bg-status-red/5 px-4 py-3">
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="mt-0.5 h-4 w-4 text-status-red shrink-0" strokeWidth={2} />
                                <div className="space-y-1">
                                    <p className="text-[12px] font-semibold text-status-red">
                                        This task already merged code.
                                    </p>
                                    <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                                        Undo the merged changes before rerunning or the new run will build on code that already landed.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Provider selector */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                                Provider
                            </span>
                            {!settingsLoaded && (
                                <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-status-amber">
                                    <Loader2 aria-hidden="true" className="h-3 w-3 motion-safe:animate-spin motion-reduce:animate-none" />
                                    Loading providers
                                </span>
                            )}
                        </div>
                        <AvantgardeSelect
                            aria-label="Provider"
                            disabled={isSubmitting || !settingsLoaded}
                            value={providerConfigId}
                            onChange={setProviderConfigId}
                            options={providerOptions}
                            placeholder="Auto (use current setting)"
                            searchable
                        />
                        {currentProvider && (
                            <p className="text-[10px] text-slate-400">
                                Current provider: <span className="font-mono font-bold">{currentProvider}</span>
                            </p>
                        )}
                    </div>

                    {showModelOverride && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                                    Model Override
                                </span>
                                {modelOptions.length === 0 && (
                                    <span role="status" aria-live="polite" className="text-[10px] font-semibold text-slate-400">
                                        Loading models
                                    </span>
                                )}
                            </div>
                            <AvantgardeSelect
                                aria-label="Model Override"
                                disabled={isSubmitting || modelOptions.length === 0}
                                value={model}
                                onChange={setModel}
                                options={[
                                    { value: "", label: "Default Model" },
                                    ...modelOptions.map((opt) => ({ value: opt.value, label: opt.label })),
                                ]}
                                placeholder="Default Model"
                            />
                        </div>
                    )}

                    {downstreamTasks.length > 0 && (
                        <label className={optionCardClass(resetDependents)}>
                            <input
                                type="checkbox"
                                checked={resetDependents}
                                onChange={(e) => setResetDependents((e.target as HTMLInputElement).checked)}
                                disabled={isSubmitting}
                                className="mt-0.5 h-4 w-4 rounded border-black/[0.15] dark:border-white/[0.15] text-status-amber focus:ring-status-amber focus-visible:ring-2 focus-visible:ring-status-amber focus:ring-offset-0 cursor-pointer disabled:opacity-50"
                            />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                    <GitBranch className="w-3 h-3 text-slate-400 group-hover:text-status-amber transition-colors" strokeWidth={2} />
                                    <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                                        Reset downstream tasks
                                    </span>
                                </div>
                                <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                                    Clear {downstreamTasks.length} dependent task{downstreamTasks.length === 1 ? "" : "s"} so the rerun starts from a clean dependency chain.
                                </p>
                                {downstreamPromptTasks.length > 0 && (
                                    <p className="text-[11px] text-status-amber mt-1 leading-snug">
                                        {downstreamPromptTasks.length} downstream task{downstreamPromptTasks.length === 1 ? "" : "s"} already started or finished and should usually be reset as well.
                                    </p>
                                )}
                                {mergedTaskCount > 1 && resetDependents && (
                                    <p className="text-[11px] text-status-red mt-1 leading-snug">
                                        Some selected downstream work already merged. Undo those landed changes before rerunning the chain.
                                    </p>
                                )}
                            </div>
                        </label>
                    )}

                    {/* Undo merge checkbox */}
                    {taskAlreadyMerged && (
                        <label className={optionCardClass(undoMerge, "red")}>
                            <input
                                type="checkbox"
                                checked={undoMerge}
                                onChange={(e) => setUndoMerge((e.target as HTMLInputElement).checked)}
                                disabled={isSubmitting}
                                className="mt-0.5 h-4 w-4 rounded border-black/[0.15] dark:border-white/[0.15] text-status-amber focus:ring-status-amber focus-visible:ring-2 focus-visible:ring-status-amber focus:ring-offset-0 cursor-pointer disabled:opacity-50"
                            />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                    <RotateCcw className="w-3 h-3 text-slate-400 group-hover:text-status-amber transition-colors" strokeWidth={2} />
                                    <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                                        Undo the Git merge
                                    </span>
                                </div>
                                <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                                    Programmatically revert the merge commit for this task in the feature branch.
                                </p>
                            </div>
                        </label>
                    )}

                    {/* Clear worktree checkbox */}
                    <label className={optionCardClass(clearWorktree)}>
                        <input
                            type="checkbox"
                            checked={clearWorktree}
                            onChange={(e) => setClearWorktree((e.target as HTMLInputElement).checked)}
                            disabled={isSubmitting}
                            className="mt-0.5 h-4 w-4 rounded border-black/[0.15] dark:border-white/[0.15] text-status-amber focus:ring-status-amber focus-visible:ring-2 focus-visible:ring-status-amber focus:ring-offset-0 cursor-pointer disabled:opacity-50"
                        />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                                <Trash2 className="w-3 h-3 text-slate-400 group-hover:text-status-amber transition-colors" strokeWidth={2} />
                                <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                                    Clear worktree
                                </span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                                Remove the existing worktree directory before rerunning. Use this for a completely fresh start.
                            </p>
                        </div>
                    </label>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-7 py-4 border-t border-black/[0.05] dark:border-white/[0.05] bg-black/[0.01] dark:bg-white/[0.01]">
                    <button
                        type="button"
                        onClick={handleClose}
                        disabled={isSubmitting}
                        className="px-4 py-2 rounded-xl text-[12px] font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-status-amber focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-800 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={isSubmitting}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[12px] font-bold bg-status-amber text-white shadow-[0_4px_16px_rgba(245,158,11,0.25)] hover:shadow-[0_6px_24px_rgba(245,158,11,0.35)] hover:-translate-y-px transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-status-amber focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-800 disabled:opacity-50"
                    >
                        <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
                        {isSubmitting ? "Rerunning..." : "Rerun Task"}
                    </button>
                </div>
            </div>
        </Modal>
    );
};
