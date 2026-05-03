import type { FunctionComponent, ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

export const VirtualizedItem: FunctionComponent<{
    children: ComponentChildren;
    defaultHeight?: number;
    className?: string;
    "data-flip-id"?: string;
}> = ({ children, defaultHeight = 120, className = "", "data-flip-id": flipId }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [isVisible, setIsVisible] = useState(true);
    const [height, setHeight] = useState(defaultHeight);

    useEffect(() => {
        if (!ref.current) return;
        const node = ref.current;
        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (entry.isIntersecting) {
                    setIsVisible(true);
                } else {
                    // Capture actual height before hiding to prevent scroll jumping
                    const rect = node.getBoundingClientRect();
                    if (rect.height > 0) {
                        setHeight(rect.height);
                    }
                    setIsVisible(false);
                }
            },
            { rootMargin: '600px 0px' } // Render 600px above and below viewport
        );

        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    return (
        <div
            ref={ref}
            className={className}
            data-flip-id={flipId}
            style={{
                minHeight: !isVisible ? `${height}px` : undefined,
                contentVisibility: isVisible ? 'visible' : 'hidden'
            }}
        >
            {isVisible ? children : null}
        </div>
    );
};
