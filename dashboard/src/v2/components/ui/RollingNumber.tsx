import type { FunctionComponent } from "preact";
import { useEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";

interface RollingNumberProps {
    value: number;
    className?: string;
}

export const RollingNumber: FunctionComponent<RollingNumberProps> = ({ value, className = "" }) => {
    const nodeRef = useRef<HTMLSpanElement>(null);
    const valueRef = useRef<number>(value);
    const isReducedMotion = useReducedMotion();
    const tokens = useGsapInteractionTokens();

    useEffect(() => {
        if (!nodeRef.current) return;

        // Initial render logic
        if (valueRef.current === undefined || isNaN(valueRef.current)) {
            nodeRef.current.textContent = value.toString();
            valueRef.current = value;
            return;
        }

        if (value === valueRef.current) {
            return;
        }

        if (isReducedMotion) {
            gsap.killTweensOf(nodeRef.current);
            nodeRef.current.textContent = value.toString();
            valueRef.current = value;
            return;
        }

        const proxy = { val: valueRef.current };
        gsap.to(proxy, {
            val: value,
            duration: tokens.asyncFeedback.duration,
            ease: tokens.asyncFeedback.ease,
            snap: { val: 1 },
            onUpdate: () => {
                if (nodeRef.current) {
                    nodeRef.current.textContent = proxy.val.toString();
                }
            }
        });

        valueRef.current = value;
    }, [value, isReducedMotion, tokens.asyncFeedback.duration, tokens.asyncFeedback.ease]);

    return (
        <span ref={nodeRef} className={`inline-block min-w-0 tabular-nums ${className}`}>
            {valueRef.current}
        </span>
    );
};
