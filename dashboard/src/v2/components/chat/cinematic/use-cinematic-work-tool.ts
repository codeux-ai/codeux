import { useEffect, useState } from "preact/hooks";
import {
  AGENT_SCENE_TOOL_IDS,
  isAgentSceneTool,
  type AgentSceneTool,
} from "../../../lib/agent-scene-tools.js";

export interface UseCinematicWorkToolOptions {
  active: boolean;
  activityKey: string;
  reducedMotion: boolean;
}

interface ActivityToolSelection {
  activityKey: string;
  tool: AgentSceneTool;
}

const TOOL_SWAP_MS = 7_000;

const readStageToolOverride = (): string | null => {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("stageTool");
};

const getInitialToolIndex = (activityKey: string): number => {
  let hash = 0;
  for (let index = 0; index < activityKey.length; index += 1) {
    hash = (Math.imul(hash, 31) + activityKey.charCodeAt(index)) >>> 0;
  }
  return hash % AGENT_SCENE_TOOL_IDS.length;
};

/**
 * Selects the cinematic avatar's work tool for an activity already owned by
 * the calling surface. Invocation ownership intentionally stays outside this
 * hook so unrelated background work cannot activate the staged agent.
 */
export function useCinematicWorkTool({
  active,
  activityKey,
  reducedMotion,
}: UseCinematicWorkToolOptions): AgentSceneTool | null {
  const stageToolOverride = readStageToolOverride();
  const forcedTool = isAgentSceneTool(stageToolOverride) ? stageToolOverride : null;
  const initialToolIndex = getInitialToolIndex(activityKey);
  const initialTool = AGENT_SCENE_TOOL_IDS[initialToolIndex];
  const [selection, setSelection] = useState<ActivityToolSelection | null>(() => (
    active && !forcedTool ? { activityKey, tool: initialTool } : null
  ));

  useEffect(() => {
    if (forcedTool || !active) {
      setSelection(null);
      return;
    }

    let toolIndex = initialToolIndex;
    setSelection({ activityKey, tool: AGENT_SCENE_TOOL_IDS[toolIndex] });

    if (reducedMotion) return;

    const interval = window.setInterval(() => {
      toolIndex = (toolIndex + 1) % AGENT_SCENE_TOOL_IDS.length;
      setSelection({ activityKey, tool: AGENT_SCENE_TOOL_IDS[toolIndex] });
    }, TOOL_SWAP_MS);

    return () => window.clearInterval(interval);
  }, [active, activityKey, forcedTool, initialToolIndex, reducedMotion, stageToolOverride]);

  if (forcedTool) return forcedTool;
  if (!active) return null;
  if (selection?.activityKey !== activityKey) return initialTool;
  return selection.tool;
}
