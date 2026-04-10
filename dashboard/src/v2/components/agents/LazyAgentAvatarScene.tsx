import { h } from "preact";
import { lazy, Suspense } from "preact/compat";
import type { AgentAvatarConfig } from "../../types.js";
import type { AgentAvatarExpression } from "../../lib/agent-avatar.js";

const AgentAvatarScene = lazy(() => import("./AgentAvatarScene.js").then((module) => ({
  default: module.AgentAvatarScene,
})));

interface LazyAgentAvatarSceneProps {
  config?: AgentAvatarConfig;
  expression?: AgentAvatarExpression;
  className?: string;
  fallbackMode?: boolean;
}

export function LazyAgentAvatarScene(props: LazyAgentAvatarSceneProps) {
  return (
    <Suspense fallback={<div className={props.className || "h-full w-full"} aria-hidden="true" />}>
      <AgentAvatarScene {...props} />
    </Suspense>
  );
}
