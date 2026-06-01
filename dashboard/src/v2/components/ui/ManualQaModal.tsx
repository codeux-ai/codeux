import type { FunctionComponent } from "preact";
import { useLayoutEffect, useMemo, useRef, useState, useEffect } from "preact/hooks";
import gsap from "gsap";
import { AlertTriangle, Sparkles, X } from "lucide-preact";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";
import type { Subtask, SystemSettings } from "../../../types.js";
import type { Sprint, AgentPreset } from "../../types.js";
import { AvantgardeSelect } from "./AvantgardeSelect.js";
import { fetchSystemSettings } from "../../lib/settings-api.js";
import { fetchAgentPresets } from "../../lib/agent-preset-api.js";
import {
    getProviderInstanceLabel,
    getProviderInstanceModelOptions,
    getSystemIntegrationProviders,
    providerSupportsModelSelection,
} from "../../lib/settings-view-models.js";
import { ProviderBrandIcon } from "../providers/ProviderBrandIcon.js";

interface ManualQaModalProps {
    sprint?: Sprint | null;
    task?: Subtask | null;
    onClose: () => void;
    onConfirm: (options: { provider?: string; providerConfigId?: string; model?: string; agentPresetId?: string }) => void | Promise<void>;
}

export const ManualQaModal: FunctionComponent<ManualQaModalProps> = ({
    sprint = null,
    task = null,
    onClose,
    onConfirm,
}) => {
    const cardRef = useRef<HTMLDivElement>(null);
    const [providerConfigId, setProviderConfigId] = useState("");
    const [agentPresetId, setAgentPresetId] = useState("");
    const [agentPresets, setAgentPresets] = useState<AgentPreset[]>([]);
    const reducedMotion = useReducedMotion();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);

    const projectId = task?.project_id || sprint?.projectId;

    useEffect(() => {
        fetchSystemSettings().then(setSystemSettings).catch(() => {});
        if (projectId) {
            fetchAgentPresets(projectId).then(setAgentPresets).catch(() => {});
        }
    }, [projectId]);

    const providerOptions = useMemo(() => {
        const base = [{ value: "", label: "Auto (use default QA setting)" }];
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

    const agentOptions = useMemo(() => {
        const base = [{ value: "", label: "Auto (use default QA agent)" }];
        const available = agentPresets.map((preset) => ({
            value: preset.id,
            label: preset.name,
        }));
        return [...base, ...available];
    }, [agentPresets]);

    useLayoutEffect(() => {
        const d_backdrop = reducedMotion ? 0 : MODAL_MOTION.backdrop.duration;
        const d_card = reducedMotion ? 0 : MODAL_MOTION.entry.duration;
        gsap.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: d_backdrop, ease: MODAL_MOTION.backdrop.ease });
        gsap.fromTo(cardRef.current,
            { y: reducedMotion ? 0 : MODAL_MOTION.entry.yStart, opacity: MODAL_MOTION.entry.opacityStart, scale: reducedMotion ? 1 : MODAL_MOTION.entry.scaleStart },
            { y: MODAL_MOTION.entry.yEnd, opacity: MODAL_MOTION.entry.opacityEnd, scale: MODAL_MOTION.entry.scaleEnd, duration: d_card, ease: MODAL_MOTION.entry.ease, delay: reducedMotion ? 0 : 0.04 },
        );
    }, [reducedMotion]);

    const handleClose = () => {
        if (isSubmitting) return;
        const duration = reducedMotion ? 0 : MODAL_MOTION.exit.duration;
        gsap.to(cardRef.current, { y: MODAL_MOTION.exit.yEnd, opacity: MODAL_MOTION.exit.opacityEnd, scale: MODAL_MOTION.exit.scaleEnd, duration, ease: MODAL_MOTION.exit.ease });
        gsap.to(backdropRef.current, { opacity: 0, duration, delay: reducedMotion ? 0 : 0.04, onComplete: onClose });
    };

    const backdropRef = useFocusTrap(true, { onClose: handleClose, restoreFocus: true });

    const handleSubmit = async () => {
        setIsSubmitting(true);
        try {
            await onConfirm({
                provider: selectedProvider?.provider,
                providerConfigId: providerConfigId || undefined,
                model: model || undefined,
                agentPresetId: agentPresetId || undefined,
            });
            setIsSubmitting(false);
            handleClose();
        } catch (err) {
            setIsSubmitting(false);
            throw err;
        }
    };

    const title = task ? `Invoke QA Review: #${task.id}` : `Invoke QA Review: ${sprint?.name || "Sprint"}`;
    const description = task 
        ? `This will manually trigger the QA Completion review for the task "${task.title}".` 
        : `This will manually trigger the QA Completion review for the sprint "${sprint?.name || "Sprint"}".`;

    return (
        <div
            ref={backdropRef}
            onClick={(e) => { if (e.target === backdropRef.current) handleClose(); }}
            className="fixed inset-0 z-[250] flex cursor-pointer items-center justify-center bg-black/50 px-6 py-8 backdrop-blur-md dark:bg-black/70"
        >
            <div
                ref={cardRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="manual-qa-modal-title"
                className="w-full max-w-md cursor-default overflow-hidden rounded-[2rem] bg-white shadow-[0_32px_80px_rgba(0,0,0,0.18)] dark:bg-void-900 dark:shadow-[0_32px_80px_rgba(0,0,0,0.6)]"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-7 pt-6 pb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-signal-500/10">
                            <Sparkles className="w-4 h-4 text-signal-500" strokeWidth={2} />
                        </div>
                        <div>
                            <h2 id="manual-qa-modal-title" className="text-base font-bold text-slate-900 dark:text-white">
                                {title}
                            </h2>
                            {task && <p className="text-[11px] text-slate-400 font-mono">#{task.id}</p>}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleClose}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.04] text-slate-400 hover:text-slate-700 dark:bg-white/[0.04] dark:text-slate-500 dark:hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
                    >
                        <X className="w-3.5 h-3.5" strokeWidth={2} />
                    </button>
                </div>

                {/* Body */}
                <div className="px-7 pb-6 space-y-5">
                    <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        {description}
                    </p>

                    {/* QA Agent Preset Selector */}
                    <div className="space-y-2">
                        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                            QA Agent Preset
                        </span>
                        <AvantgardeSelect
                            aria-label="QA Agent Preset"
                            disabled={isSubmitting}
                            value={agentPresetId}
                            onChange={setAgentPresetId}
                            options={agentOptions}
                            placeholder="Auto (use default QA agent)"
                        />
                    </div>

                    {/* Provider selector */}
                    <div className="space-y-2">
                        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                            Provider
                        </span>
                        <AvantgardeSelect
                            aria-label="Provider"
                            disabled={isSubmitting}
                            value={providerConfigId}
                            onChange={setProviderConfigId}
                            options={providerOptions}
                            placeholder="Auto (use default QA setting)"
                            searchable
                        />
                    </div>

                    {showModelOverride && (
                        <div className="space-y-2">
                            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                                Model Override
                            </span>
                            <AvantgardeSelect
                                aria-label="Model Override"
                                disabled={isSubmitting}
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
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-7 py-4 border-t border-black/[0.05] dark:border-white/[0.05] bg-black/[0.01] dark:bg-white/[0.01]">
                    <button
                        type="button"
                        onClick={handleClose}
                        disabled={isSubmitting}
                        className="px-4 py-2 rounded-xl text-[12px] font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-800 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={isSubmitting}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[12px] font-bold bg-signal-500 text-void-900 shadow-[0_4px_16px_rgba(0,224,160,0.25)] hover:shadow-[0_6px_24px_rgba(0,224,160,0.35)] hover:-translate-y-px transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-800 disabled:opacity-50"
                    >
                        <Sparkles className="w-3.5 h-3.5" strokeWidth={2} />
                        {isSubmitting ? "Invoking..." : "Invoke QA"}
                    </button>
                </div>
            </div>
        </div>
    );
};
