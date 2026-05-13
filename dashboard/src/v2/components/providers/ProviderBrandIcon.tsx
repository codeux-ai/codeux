import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import type { ProviderId } from "../../../types.js";

export type BrandIconId = ProviderId | "github";

const LOBE_ICON_BASE_URL = "/lobe-icons";

const brandIcons: Record<BrandIconId, { slug: string; fallback: string; label: string }> = {
  jules: { slug: "google-color", fallback: "J", label: "Jules" },
  gemini: { slug: "gemini-color", fallback: "G", label: "Gemini" },
  codex: { slug: "codex-color", fallback: "C", label: "Codex" },
  "claude-code": { slug: "claude", fallback: "C", label: "Claude Code" },
  "qwen-code": { slug: "qwen-color", fallback: "Q", label: "Qwen Code" },
  opencode: { slug: "opencode", fallback: "O", label: "OpenCode" },
  github: { slug: "github", fallback: "GH", label: "GitHub" },
};

const getBrandIcon = (id: ProviderId | "github" | string): { slug: string; fallback: string; label: string } => (
  brandIcons[(id in brandIcons ? id : "jules") as BrandIconId]
);

export const ProviderBrandIcon: FunctionComponent<{
  id: ProviderId | "github" | string;
  disabled?: boolean;
  className?: string;
  imageClassName?: string;
}> = ({ id, disabled = false, className = "", imageClassName = "" }) => {
  const [failed, setFailed] = useState(false);
  const icon = getBrandIcon(id);

  return (
    <span
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] border border-black/[0.08] bg-[#F9F8F4] text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] dark:border-white/[0.08] dark:bg-[#F9F8F4] ${disabled ? "opacity-60 grayscale" : ""} ${className}`}
      aria-hidden
      title={icon.label}
    >
      {failed ? (
        <span className="font-display text-[11px] font-black tracking-[0.12em] text-slate-700">
          {icon.fallback}
        </span>
      ) : (
        <img
          alt=""
          src={`${LOBE_ICON_BASE_URL}/${icon.slug}.svg`}
          className={`h-6 w-6 object-contain ${imageClassName}`}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
};
