import type { FunctionComponent } from "preact";
import { useEffect, useRef } from "preact/hooks";
import gsap from "gsap";

interface RollingNumberProps {
    value: number;
    className?: string;
}

export const RollingNumber: FunctionComponent<RollingNumberProps> = ({ value, className = "" }) => {
    const nodeRef = useRef<HTMLSpanElement>(null);
    const valueRef = useRef<number>(value);

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

        const proxy = { val: valueRef.current };
        gsap.to(proxy, {
            val: value,
            duration: 0.5,
            ease: "power2.out",
            snap: { val: 1 },
            onUpdate: () => {
                if (nodeRef.current) {
                    nodeRef.current.textContent = proxy.val.toString();
                }
            }
        });

        valueRef.current = value;
    }, [value]);

    return (
        <span ref={nodeRef} className={className}>
            {valueRef.current}
        </span>
    );
};
