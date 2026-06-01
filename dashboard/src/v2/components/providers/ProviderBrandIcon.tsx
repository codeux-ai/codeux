import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import type { ProviderId } from "../../../types.js";

export type BrandIconId = ProviderId | "github";
export type GitHostBrandIconId = BrandIconId | "gitlab";

const LOBE_ICON_BASE_URL = "/lobe-icons";

const brandIcons: Record<GitHostBrandIconId, { slug: string; fallback: string; label: string }> = {
  jules: { slug: "google-color", fallback: "J", label: "Jules" },
  gemini: { slug: "gemini-color", fallback: "G", label: "Gemini" },
  codex: { slug: "codex-color", fallback: "C", label: "Codex" },
  "claude-code": { slug: "claude", fallback: "C", label: "Claude Code" },
  "qwen-code": { slug: "qwen-color", fallback: "Q", label: "Qwen Code" },
  opencode: { slug: "opencode", fallback: "O", label: "OpenCode" },
  antigravity: { slug: "google-color", fallback: "AGY", label: "Antigravity" },
  github: { slug: "github", fallback: "GH", label: "GitHub" },
  gitlab: { slug: "gitlab", fallback: "GL", label: "GitLab" },
};

const getBrandIcon = (id: ProviderId | "github" | "gitlab" | string): { slug: string; fallback: string; label: string } => (
  brandIcons[(id in brandIcons ? id : "jules") as GitHostBrandIconId]
);

export const ProviderBrandIcon: FunctionComponent<{
  id: ProviderId | "github" | "gitlab" | string;
  disabled?: boolean;
  className?: string;
  imageClassName?: string;
}> = ({ id, disabled = false, className = "", imageClassName = "" }) => {
  const [failed, setFailed] = useState(false);
  const icon = getBrandIcon(id);

  const hasHeight = className.split(/\s+/).some(c => c.startsWith("h-"));
  const hasWidth = className.split(/\s+/).some(c => c.startsWith("w-"));
  const hasRounded = className.split(/\s+/).some(c => c.startsWith("rounded-"));

  const sizeClasses = hasHeight || hasWidth ? "" : "h-11 w-11";
  const roundedClasses = hasRounded ? "" : "rounded-[1rem]";

  const hasImgHeight = imageClassName.split(/\s+/).some(c => c.startsWith("h-"));
  const hasImgWidth = imageClassName.split(/\s+/).some(c => c.startsWith("w-"));
  const imgSizeClasses = hasImgHeight || hasImgWidth ? "" : "h-6 w-6";

  let textClass = "text-[11px] tracking-[0.12em]";
  if (className.includes("w-3") || className.includes("h-3")) {
    textClass = "text-[6px] tracking-normal";
  } else if (className.includes("w-4") || className.includes("h-4")) {
    textClass = "text-[8px] tracking-[0.02em]";
  } else if (className.includes("w-[18px]") || className.includes("h-[18px]")) {
    textClass = "text-[9px] tracking-[0.05em]";
  } else if (className.includes("w-5") || className.includes("h-5")) {
    textClass = "text-[10px] tracking-[0.08em]";
  } else if (className.includes("w-6") || className.includes("h-6")) {
    textClass = "text-[11px] tracking-[0.1em]";
  }

  return (
    <span
      className={`flex shrink-0 items-center justify-center border border-black/[0.08] bg-[#F9F8F4] text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] dark:border-white/[0.08] dark:bg-[#F9F8F4] ${sizeClasses} ${roundedClasses} ${disabled ? "opacity-60 grayscale" : ""} ${className}`}
      aria-hidden
      title={icon.label}
    >
      {failed ? (
        <span className={`font-display font-black text-slate-700 ${textClass}`}>
          {icon.fallback}
        </span>
      ) : (
        <img
          alt=""
          src={`${LOBE_ICON_BASE_URL}/${icon.slug}.svg`}
          className={`object-contain ${imgSizeClasses} ${imageClassName}`}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
};
