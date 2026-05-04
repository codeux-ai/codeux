import { type FunctionComponent, type ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

interface VirtualizedItemProps {
  children: ComponentChildren;
  height?: string;
  defaultVisible?: boolean;
}

export const VirtualizedItem: FunctionComponent<VirtualizedItemProps> = ({
  children,
  height = "auto",
  defaultVisible = false
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(defaultVisible);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
          } else {
            setIsVisible(false);
          }
        });
      },
      {
        rootMargin: "200px 0px 200px 0px",
      }
    );

    observer.observe(el);

    return () => {
      if (el) observer.unobserve(el);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        height: isVisible ? "auto" : height,
        contentVisibility: "auto",
        minHeight: height !== "auto" ? height : "100px",
      }}
    >
      {isVisible ? children : null}
    </div>
  );
};
