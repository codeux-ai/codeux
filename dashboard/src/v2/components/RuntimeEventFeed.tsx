import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion, useResolvedMotionDuration } from "../hooks/use-reduced-motion.js";
import { INTERACTION_TOKENS } from "../../v2/lib/motion/tokens.js";
import { Terminal, Activity } from "lucide-preact";
import type { ExecutionRuntimeEventSummary } from "../../types.js";
import { getOriginatorCfg, getExecutionEventText } from "../lib/live-session-config.js";
import { useLiveI18n } from "../i18n/messages/live.js";

// English compatibility label: Loading runtime events. The localized value comes from the Live catalog.

const RuntimeEventFeed: FunctionComponent<{ events?: ExecutionRuntimeEventSummary[] }> = memo(({ events }) => {
    const { t, formatTime } = useLiveI18n();
    const feedRef = useRef<HTMLDivElement>(null);
    const prevCountRef = useRef<number>(0);
    const isReducedMotion = useReducedMotion();
    const durationStr = INTERACTION_TOKENS?.enterExit?.duration || "300ms";
    const duration = useResolvedMotionDuration(parseFloat(durationStr) / 1000);
    const formatEventTime = (value: string | number | undefined): string => {
        const date = new Date(value ?? Date.now());
        return Number.isFinite(date.getTime()) ? formatTime(date) : "";
    };

    useLayoutEffect(() => {
        if (!feedRef.current || isReducedMotion || !events) {
            prevCountRef.current = events?.length || 0;
            return;
        }

        const currentCount = events.length;
        if (currentCount > prevCountRef.current) {
            const newElements = Array.from(feedRef.current.children).filter(el => !el.hasAttribute('data-entered'));

            if (newElements.length > 0) {
                gsap.fromTo(newElements,
                    { opacity: 0, x: 10, backgroundColor: 'rgba(0,224,160,0.1)' },
                    { opacity: 1, x: 0, backgroundColor: 'transparent', duration: duration, stagger: 0.05, ease: INTERACTION_TOKENS?.enterExit?.ease || "power3.out" }
                );
                newElements.forEach(el => el.setAttribute('data-entered', 'true'));
            }
        }
        prevCountRef.current = currentCount;
    }, [events?.length, isReducedMotion, duration]);

    useEffect(() => {
        const el = feedRef.current;
        if (!el) return;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distanceFromBottom < 120) {
            el.scrollTop = el.scrollHeight;
        }
    }, [events]);

    if (!events) {
        return (
            <div role="status" aria-live="polite" aria-busy="true" className="flex flex-col items-center justify-center rounded-xl border border-black/[0.08] bg-white py-12 text-slate-400 shadow-sm dark:border-white/[0.08] dark:bg-void-800 dark:text-slate-600">
                <Activity className="w-8 h-8 mb-3 opacity-40 text-signal-500" strokeWidth={1.5} aria-hidden="true" />
                <p className="text-sm font-bold tracking-tight text-slate-600 dark:text-slate-400">{t("loadingRuntimeEvents")}</p>
                <p className="text-xs mt-1 font-mono opacity-80">{t("runtimeFeedLoading")}</p>
            </div>
        );
    }

    if (events.length === 0) {
        return (
            <div role="status" aria-live="polite" aria-busy="false" className="flex flex-col items-center justify-center rounded-xl border border-black/[0.08] bg-white py-12 text-slate-400 shadow-sm dark:border-white/[0.08] dark:bg-void-800 dark:text-slate-600">
                <Activity className="w-8 h-8 mb-3 opacity-40 text-signal-500" strokeWidth={1.5} aria-hidden="true" />
                <p className="text-sm font-bold tracking-tight text-slate-600 dark:text-slate-400">{t("noRuntimeEvents")}</p>
                <p className="text-xs mt-1 font-mono opacity-80">{t("listeningForActivity")}</p>
            </div>
        );
    }

    return (
        <div ref={feedRef} className="max-h-[50dvh] sm:max-h-64 overflow-y-auto pr-2 dashboard-scrollbar space-y-1" aria-live="polite" aria-relevant="additions text" role="log" aria-label={t("runtimeFeed")} aria-busy="false">
            {events.map((event) => {
                const cfg = getOriginatorCfg(event.originator || "system");
                const originatorLabel = t((({ Agent: "originatorAgent", User: "originatorUser", Provider: "originatorProvider", System: "originatorSystem" } as const)[cfg.label as "Agent" | "User" | "Provider" | "System"] ?? "originatorSystem"));
                const isError = event.eventType.toLowerCase().includes("error") || event.eventType.toLowerCase().includes("fail");
                const eventTypeLabel = event.eventType.replace(/_/g, " ");
                return (
                    <div key={event.id} className={`flex gap-3 border-l-2 ${isError ? 'border-status-red' : cfg.border} ${isError ? 'bg-status-red/[0.04]' : ''} pl-3 py-2 group/entry hover:bg-black/[0.02] dark:hover:bg-white/[0.02] rounded-r-lg transition-colors duration-[var(--interaction-control-feedback-duration)] motion-reduce:transition-none`} aria-label={t("eventAria", { kind: t(isError ? "errorEvent" : "runtimeEvent"), eventType: eventTypeLabel, originator: originatorLabel, time: formatEventTime(event.createdAt ?? (event as { timestamp?: number }).timestamp) })}>
                        <div className="flex-grow min-w-0">
                            <div className="mb-0.5 flex flex-wrap items-center gap-2">
                                <span className={`text-[9px] font-bold uppercase tracking-[0.14em] ${isError ? 'text-status-red' : cfg.text}`}>
                                    {originatorLabel}
                                </span>
                                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">
                                    {eventTypeLabel}
                                </span>
                                <span className="text-[9px] text-slate-400 dark:text-slate-600 font-mono">
                                    {formatEventTime(event.createdAt ?? (event as { timestamp?: number }).timestamp)}
                                </span>
                            </div>
                            <div className="text-[12px] text-slate-600 dark:text-slate-400 leading-relaxed font-mono line-clamp-2 group-hover/entry:line-clamp-none transition-all duration-[var(--interaction-control-feedback-duration)] motion-reduce:transition-none cursor-default break-words">
                                {getExecutionEventText(event)}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
});

export { RuntimeEventFeed };
