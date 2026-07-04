import type { FunctionComponent } from "preact";
import { useEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";

export interface LiveDurationBadgeProps {
    durationText: string | undefined;
    flashTriggerCount: number;
}

export const LiveDurationBadge: FunctionComponent<LiveDurationBadgeProps> = ({ durationText, flashTriggerCount }) => {
    const ref = useRef<HTMLSpanElement>(null);
    const prevTriggerCount = useRef<number>(flashTriggerCount);
    const isReducedMotion = useReducedMotion();
    const tokens = useGsapInteractionTokens();

    useEffect(() => {
        if (flashTriggerCount > prevTriggerCount.current && ref.current) {
            if (isReducedMotion) {
                gsap.set(ref.current, { backgroundColor: "var(--primitive-signal-highlight)", boxShadow: "inset 0 0 0 1px var(--status-static-running-ring)" });
                setTimeout(() => {
                    if (ref.current) gsap.set(ref.current, { backgroundColor: "transparent", clearProps: "boxShadow" });
                }, Math.max(tokens.controlFeedback.duration * 1000, 1));
            } else {
                gsap.fromTo(
                    ref.current,
                    { backgroundColor: "var(--primitive-signal-highlight)", boxShadow: "inset 0 0 0 1px var(--status-static-running-ring)" },
                    { backgroundColor: "transparent", boxShadow: "inset 0 0 0 0 var(--status-static-running-aura)", duration: tokens.controlFeedback.duration, ease: tokens.controlFeedback.ease, clearProps: "boxShadow" }
                );
            }
        }
        prevTriggerCount.current = flashTriggerCount;
    }, [flashTriggerCount, isReducedMotion, tokens.controlFeedback.duration, tokens.controlFeedback.ease]);

    return (
        <span
            ref={ref}
            className="inline-block min-w-0 max-w-full truncate break-words rounded px-0.5 -ml-0.5 font-mono tabular-nums"
        >
            <span className="sr-only">Live duration: </span>
            {durationText}
        </span>
    );
};
