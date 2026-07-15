import { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import { activeMemoryIdSignal, hoveredMemoryIdSignal, lobotomizeModeSignal, memoryMutationsSignal, selectedMemoryIdsSignal, toggleSelectedMemoryId } from "./memoryState.js";
import { useComputed } from "@preact/signals";
import { AlertTriangle, ArrowUpRight, Check, Trash2, X } from "lucide-preact";
import { useInteractionTokens } from "../../lib/motion/index.js";
import type { MemoryScope } from "../../memory-types.js";
import { MEMORY_CATEGORY_MESSAGE_KEYS, MEMORY_SCOPE_MESSAGE_KEYS, useMemoryI18n } from "../../i18n/messages/memory.js";

interface MemoryCardProps {
    id: string;
    content: string;
    category: string;
    strength: number;
    scope?: MemoryScope | string;
    onClick: () => void;
    readOnly?: boolean;
    entityLabel?: "memory" | "skill";
}

const CAT: Record<string, { hex: string }> = {
    architecture: { hex: "#00E0A0" }, codebase: { hex: "#FFB800" }, context: { hex: "#8B5CF6" },
    preferences: { hex: "#94A3B8" }, patterns: { hex: "#F59E0B" }, decision: { hex: "#64748B" },
    error: { hex: "#F43F5E" }, learning: { hex: "#33FFB8" },
};

export const MemoryCard: FunctionComponent<MemoryCardProps> = memo(({
    id,
    content,
    category,
    strength,
    scope,
    onClick,
    readOnly = false,
    entityLabel = "memory",
}) => {
    const cat = CAT[category] || CAT.context;
    const isSelected = useComputed(() => activeMemoryIdSignal.value === id);
    const isBatchSelected = useComputed(() => selectedMemoryIdsSignal.value.includes(id));
    const interactionTokens = useInteractionTokens();
    const { formatNumber, t } = useMemoryI18n();
    const [deleteArmed, setDeleteArmed] = useState(false);
    const deleteLockRef = useRef(false);
    const categoryLabel = t(MEMORY_CATEGORY_MESSAGE_KEYS[category as keyof typeof MEMORY_CATEGORY_MESSAGE_KEYS] ?? "categoryContext");
    const scopeLabel = scope && scope in MEMORY_SCOPE_MESSAGE_KEYS ? t(MEMORY_SCOPE_MESSAGE_KEYS[scope as MemoryScope]) : t("scopeUnknown");
    const strengthPercent = formatNumber(strength, { style: "percent", maximumFractionDigits: 0 });
    const entity = t(entityLabel === "skill" ? "skillNoun" : "memoryNoun");
    const mutationFeedback = memoryMutationsSignal.value.feedback;
    const isDeletePending = mutationFeedback.status === "pending";
    const selectedState = isSelected.value ? t("currentlyOpen") : isBatchSelected.value ? t("selectedForBatch") : t("notSelected");
    const controlTransitionStyle = {
        transitionDuration: interactionTokens.controlFeedback.duration,
        transitionTimingFunction: interactionTokens.controlFeedback.ease,
    };
    const inlineValidationStyle = {
        transitionDuration: interactionTokens.inlineValidation.duration,
        transitionTimingFunction: interactionTokens.inlineValidation.ease,
    };

    useEffect(() => {
        setDeleteArmed(false);
    }, [id, lobotomizeModeSignal.value]);

    const handleDelete = (e: Event) => {
        e.stopPropagation();
        if (deleteLockRef.current || isDeletePending) {
            return;
        }
        if (!deleteArmed) {
            setDeleteArmed(true);
            return;
        }
        deleteLockRef.current = true;
        memoryMutationsSignal.value.removeMemory(id);
        setDeleteArmed(false);
        window.setTimeout(() => {
            deleteLockRef.current = false;
        }, 0);
    };

    const handleOpen = (e: Event) => {
        e.stopPropagation();
        onClick();
    };

    return (
        <div
            role="option"
            tabIndex={0}
            aria-selected={isSelected.value}
            aria-label={t("cardAria", { category: categoryLabel, entity, scope: scopeLabel, strength: strengthPercent, selectionState: selectedState, content })}
            onClick={onClick}
            onMouseEnter={() => { hoveredMemoryIdSignal.value = id; }}
            onMouseLeave={() => { hoveredMemoryIdSignal.value = null; }}
            onKeyDown={(e) => {
                if (e.currentTarget !== e.target) {
                    return;
                }
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick();
                }
            }}
            style={{
                transitionProperty: "background-color, border-color, box-shadow, transform",
                transitionDuration: interactionTokens.selectionMovement.duration,
                transitionTimingFunction: interactionTokens.selectionMovement.ease,
            }}
            className={`
                group relative w-full cursor-pointer overflow-hidden rounded-xl border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900
                ${isSelected.value
                    ? "z-10 border-signal-500/80 bg-signal-500/[0.08] shadow-[0_8px_24px_rgba(0,224,160,0.12)] ring-1 ring-signal-500/40"
                    : isBatchSelected.value
                        ? "border-signal-500/35 bg-signal-500/[0.05] ring-1 ring-signal-500/20"
                        : "border-black/[0.06] bg-white/70 hover:border-black/[0.1] hover:bg-white hover:shadow-[0_6px_18px_rgba(0,0,0,0.06)] dark:border-white/[0.06] dark:bg-void-800/70 dark:hover:border-white/[0.12] dark:hover:bg-void-800 dark:hover:shadow-[0_10px_24px_rgba(0,0,0,0.26)]"
                }
                ${lobotomizeModeSignal.value ? "border-status-red/35 ring-1 ring-status-red/25 hover:border-status-red/70 hover:bg-status-red/[0.08] hover:ring-status-red/45" : ""}
            `}
        >
            <div
                className={`absolute inset-y-2 left-0 w-0.5 rounded-r-full transition-opacity ${isSelected.value || isBatchSelected.value ? "opacity-100" : "opacity-55 group-hover:opacity-100"}`}
                style={{ background: cat.hex, boxShadow: isSelected.value ? `0 0 12px ${cat.hex}` : undefined }}
                aria-hidden="true"
            />
            <div className="flex min-w-0 flex-col gap-2.5 pl-2">
                <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: cat.hex }} aria-hidden="true" />
                            <span className="truncate text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: cat.hex }}>
                                {categoryLabel}
                            </span>
                        </div>
                        <span className="truncate text-[10px] font-mono font-medium uppercase text-slate-400 dark:text-slate-500">
                            {t("scopeLabel", { scope: scopeLabel })}
                        </span>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="rounded-md border border-black/[0.06] bg-black/[0.03] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
                            {strengthPercent}
                        </span>
                        {(isSelected.value || isBatchSelected.value) && (
                            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${isSelected.value ? "bg-signal-500 text-white dark:text-void-950" : "bg-signal-500/[0.12] text-signal-600 dark:text-signal-300"}`}>
                                {isSelected.value ? t("open") : t("selected")}
                            </span>
                        )}
                    </div>
                </div>

                <p className="line-clamp-3 break-words text-[13px] font-semibold leading-snug text-slate-700 dark:text-void-100">
                    {content}
                </p>

                {!readOnly && lobotomizeModeSignal.value && (
                    <div
                        id={`danger-delete-${id}`}
                        className={`flex min-w-0 items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] font-semibold leading-4 ${
                            deleteArmed
                                ? "border-status-red/35 bg-status-red/[0.12] text-status-red"
                                : "border-status-red/20 bg-status-red/[0.07] text-status-red"
                        }`}
                        style={inlineValidationStyle}
                    >
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 break-words">
                            {deleteArmed
                                ? isDeletePending ? t("deletePendingCard") : t("deleteArmedCard")
                                : t("dangerCard")}
                        </span>
                    </div>
                )}

                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-black/[0.05] pt-2 dark:border-white/[0.06]">
                    {!readOnly && <button
                        type="button"
                        aria-pressed={isBatchSelected.value}
                        aria-label={t(isBatchSelected.value ? "deselectCategoryMemory" : "selectCategoryMemory", { category: categoryLabel })}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (isDeletePending) {
                                return;
                            }
                            toggleSelectedMemoryId(id);
                        }}
                        disabled={isDeletePending}
                        title={isDeletePending ? t("selectionLocked") : undefined}
                        style={controlTransitionStyle}
                        className={`inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-void-900
                            ${isBatchSelected.value
                                ? "border-signal-500 bg-signal-500 text-white dark:text-void-950 shadow-[0_4px_14px_rgba(0,224,160,0.18)]"
                                : "border-black/[0.06] bg-black/[0.03] text-slate-500 hover:border-signal-500/45 hover:bg-signal-500/[0.08] hover:text-signal-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:text-signal-400"
                            }`}
                    >
                        <Check size={13} strokeWidth={3} aria-hidden="true" className={isBatchSelected.value ? "opacity-100" : "opacity-45"} />
                        <span className="truncate">{isBatchSelected.value ? t("selected") : t("select")}</span>
                    </button>}
                    <div className="flex shrink-0 items-center gap-1.5">
                        <button
                            type="button"
                            aria-label={t("openCategoryDetails", { category: categoryLabel, entity })}
                            onClick={handleOpen}
                            style={controlTransitionStyle}
                            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-black/[0.04] hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white dark:focus-visible:ring-offset-void-900"
                        >
                            <span>{t("open")}</span>
                            <ArrowUpRight size={13} strokeWidth={2.5} aria-hidden="true" />
                        </button>
                        {!readOnly && lobotomizeModeSignal.value && (
                            <div className="flex shrink-0 items-center gap-1.5">
                                {deleteArmed && (
                                    <button
                                        type="button"
                                        aria-label={t("cancelCategoryDelete", { category: categoryLabel })}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const armButton = e.currentTarget.parentElement?.querySelector("[aria-pressed]") as HTMLElement | null;
                                            setDeleteArmed(false);
                                            requestAnimationFrame(() => {
                                                armButton?.focus();
                                            });
                                        }}
                                        style={controlTransitionStyle}
                                        className="inline-flex h-7 items-center gap-1 rounded-md border border-black/[0.06] bg-black/[0.03] px-2 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-black/[0.06] hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white dark:focus-visible:ring-offset-void-900"
                                    >
                                        <X size={13} strokeWidth={2.5} aria-hidden="true" />
                                        {t("cancel")}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    aria-label={t(deleteArmed ? "confirmCategoryDelete" : "armCategoryDelete", { category: categoryLabel, content: content.substring(0, 30) })}
                                    aria-describedby={`danger-delete-${id}`}
                                    aria-pressed={deleteArmed}
                                    aria-busy={isDeletePending}
                                    disabled={isDeletePending}
                                    onClick={handleDelete}
                                    style={controlTransitionStyle}
                                    className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 dark:focus-visible:ring-offset-void-900 ${
                                        deleteArmed
                                            ? "border-status-red bg-status-red text-white hover:bg-status-red/90"
                                            : "border-status-red/30 bg-status-red/[0.08] text-status-red hover:border-status-red hover:bg-status-red/[0.14]"
                                    }`}
                                >
                                    <Trash2 size={13} strokeWidth={2.5} aria-hidden="true" />
                                    {deleteArmed ? t("deleteNow") : t("armDelete")}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <span className="sr-only">{t("pressEnterOpen")}</span>
        </div>
    );
}, (prevProps, nextProps) => {
    return prevProps.id === nextProps.id &&
           prevProps.content === nextProps.content &&
           prevProps.category === nextProps.category &&
           prevProps.strength === nextProps.strength &&
           prevProps.scope === nextProps.scope
});
