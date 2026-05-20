import type { AgentAvatarConfig } from "../../types.js";
import { generateRandomAgentAvatar } from "../../lib/agent-avatar.js";
import { AgentAvatarSvg } from "./AgentAvatarSvg.js";

interface AgentSelectAvatarIconProps {
  avatarConfig?: AgentAvatarConfig;
  seed: string;
}

const hasRobotAvatarConfig = (config?: AgentAvatarConfig): boolean => Boolean(
  config?.chassis
  || config?.eyes
  || config?.antenna
  || config?.wings
  || config?.headphones
  || config?.accent
  || config?.baseColor
  || config?.visorColor,
);

const resolveSelectAvatarConfig = (seed: string, avatarConfig?: AgentAvatarConfig): AgentAvatarConfig => (
  hasRobotAvatarConfig(avatarConfig) ? avatarConfig! : generateRandomAgentAvatar(seed)
);

export function AgentSelectAvatarIcon({ avatarConfig, seed }: AgentSelectAvatarIconProps) {
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-md border border-black/[0.06] bg-white/75 dark:border-white/[0.08] dark:bg-white/[0.04]">
      <AgentAvatarSvg config={resolveSelectAvatarConfig(seed, avatarConfig)} size={20} static />
    </span>
  );
}
