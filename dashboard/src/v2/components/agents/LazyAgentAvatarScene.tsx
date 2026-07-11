import { h } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import type { AgentAvatarConfig } from "../../types.js";
import type { AgentAvatarExpression } from "../../lib/agent-avatar.js";
import type { AgentResponseAnimation } from "../../../../../src/contracts/connection-chat-types.js";
import type { AgentSceneTool } from "./AgentAvatarScene.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { AgentAvatarSvg } from "./AgentAvatarSvg.js";

const AgentAvatarScene = lazy(() => import("./AgentAvatarScene.js").then((module) => ({
  default: module.AgentAvatarScene,
})));

export interface LazyAgentAvatarSceneProps {
  config?: AgentAvatarConfig;
  expression?: AgentAvatarExpression;
  animation?: AgentResponseAnimation;
  className?: string;
  fallbackMode?: boolean;
  eager?: boolean;
  pointerTracking?: "hover" | "window";
  tool?: AgentSceneTool | null;
}

function AgentAvatarSceneFallback({
  config,
  expression,
  className = "h-full w-full",
}: Pick<LazyAgentAvatarSceneProps, "config" | "expression" | "className">) {
  return (
    <div
      className={`flex items-center justify-center rounded-2xl bg-slate-50 dark:bg-void-800/40 ${className}`}
      style={{ minHeight: "200px", width: "100%", height: "100%" }}
      data-testid="agent-avatar-fallback"
      role="img"
      aria-label="Agent avatar preview"
    >
      <AgentAvatarSvg config={config} expression={expression} className="h-full w-full max-w-[220px]" static />
    </div>
  );
}

export function LazyAgentAvatarScene(props: LazyAgentAvatarSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const shouldUseFallback = props.fallbackMode || reducedMotion;
  const [isVisible, setIsVisible] = useState(() => props.eager === true);
  const shouldLoadScene = props.eager || isVisible;

  useEffect(() => {
    if (shouldLoadScene || shouldUseFallback) return;
    const host = hostRef.current;
    if (!host) return;
    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px 0px", threshold: 0.01 },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [shouldLoadScene, shouldUseFallback]);

  if (shouldUseFallback || !shouldLoadScene) {
    return (
      <div ref={hostRef} className={props.className || "h-full w-full"} data-testid="lazy-agent-avatar-scene">
        <AgentAvatarSceneFallback {...props} />
      </div>
    );
  }

  return (
    <Suspense fallback={<AgentAvatarSceneFallback {...props} />}>
      <AgentAvatarScene {...props} />
    </Suspense>
  );
}
