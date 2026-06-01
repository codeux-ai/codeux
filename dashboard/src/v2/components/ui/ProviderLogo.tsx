import { h, FunctionComponent } from "preact";
import { Bot } from "lucide-preact";
import { ProviderBrandIcon } from "../providers/ProviderBrandIcon.js";

export interface ProviderLogoProps {
  provider: string;
  size?: number;
  className?: string;
  title?: string;
}

export const ProviderLogo: FunctionComponent<ProviderLogoProps> = ({
  provider,
  size = 20,
  className = "",
  title,
}) => {
  const normalizedProvider = provider.toLowerCase();

  let matchedProviderId: string | null = null;
  if (normalizedProvider.includes("antigravity")) {
    matchedProviderId = "antigravity";
  } else if (normalizedProvider.includes("gemini")) {
    matchedProviderId = "gemini";
  } else if (normalizedProvider.includes("codex")) {
    matchedProviderId = "codex";
  } else if (normalizedProvider.includes("claude")) {
    matchedProviderId = "claude-code";
  } else if (normalizedProvider.includes("qwen")) {
    matchedProviderId = "qwen-code";
  } else if (normalizedProvider.includes("opencode")) {
    matchedProviderId = "opencode";
  } else if (
    normalizedProvider === "jules" ||
    normalizedProvider.startsWith("jules-") ||
    normalizedProvider.startsWith("jules_")
  ) {
    matchedProviderId = "jules";
  }

  if (matchedProviderId) {
    let sizeClasses = "w-5 h-5 rounded-[0.375rem]";
    let imgSizeClasses = "w-3 h-3";

    if (size <= 12) {
      sizeClasses = "w-3 h-3 rounded-[0.25rem]";
      imgSizeClasses = "w-2 h-2";
    } else if (size <= 16) {
      sizeClasses = "w-4 h-4 rounded-[0.3rem]";
      imgSizeClasses = "w-2.5 h-2.5";
    } else if (size <= 18) {
      sizeClasses = "w-[18px] h-[18px] rounded-[0.35rem]";
      imgSizeClasses = "w-[11px] h-[11px]";
    } else if (size <= 20) {
      sizeClasses = "w-5 h-5 rounded-[0.375rem]";
      imgSizeClasses = "w-3 h-3";
    } else if (size <= 24) {
      sizeClasses = "w-6 h-6 rounded-[0.5rem]";
      imgSizeClasses = "w-3.5 h-3.5";
    } else {
      sizeClasses = `w-[${size}px] h-[${size}px] rounded-[0.5rem]`;
      imgSizeClasses = `w-[${Math.round(size * 0.6)}px] h-[${Math.round(size * 0.6)}px]`;
    }

    return (
      <ProviderBrandIcon
        id={matchedProviderId}
        className={`${sizeClasses} ${className}`}
        imageClassName={imgSizeClasses}
      />
    );
  }

  return <Bot size={size} className={`text-slate-500 ${className}`} />;
};
