import type { FunctionComponent } from "preact";
import { useEffect, useRef } from "preact/hooks";
import gsap from "gsap";

export interface LiveDurationBadgeProps {
    durationText: string | undefined;
    flashTriggerCount: number;
}

export const LiveDurationBadge: FunctionComponent<LiveDurationBadgeProps> = ({ durationText, flashTriggerCount }) => {
    const ref = useRef<HTMLSpanElement>(null);
    const prevTriggerCount = useRef<number>(flashTriggerCount);

    useEffect(() => {
        if (flashTriggerCount > prevTriggerCount.current && ref.current) {
            gsap.fromTo(
                ref.current,
                // Use a subtle highlight color from the existing theme (e.g. 10% opacity of signal-500)
                { backgroundColor: "rgba(0, 224, 160, 0.10)" },
                { backgroundColor: "transparent", duration: 0.5, ease: "power2.out" }
            );
        }
        prevTriggerCount.current = flashTriggerCount;
    }, [flashTriggerCount]);

    return (
        <span
            ref={ref}
            className="font-mono truncate tabular-nums rounded px-0.5 -ml-0.5"
        >
            {durationText}
        </span>
    );
};
