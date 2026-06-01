import { h, FunctionComponent } from "preact";
import { Bot } from "lucide-preact";

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

  if (normalizedProvider.includes("claude")) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        class={className}
        aria-label={title}
      >
        {title && <title>{title}</title>}
        <path
          d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
          fill="#FF6B2B"
        />
        <path d="M12 22V12L22 9.27L17 14.14L18.18 21.02L12 22Z" fill="#E65A20" />
      </svg>
    );
  }

  if (normalizedProvider.includes("gemini")) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        class={className}
        aria-label={title}
      >
        {title && <title>{title}</title>}
        <path
          d="M12 2L14 8L20 10L14 12L12 18L10 12L4 10L10 8L12 2Z"
          fill="#4285F4"
        />
        <path d="M18 16L19 19L22 20L19 21L18 24L17 21L14 20L17 19L18 16Z" fill="#4285F4" />
      </svg>
    );
  }

  if (normalizedProvider.includes("codex")) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        class={className}
        aria-label={title}
      >
        {title && <title>{title}</title>}
        <rect x="3" y="3" width="18" height="18" rx="4" fill="#10B981" />
        <path
          d="M8 12L11 15L16 9"
          stroke="white"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    );
  }

  if (normalizedProvider === "jules" || normalizedProvider.startsWith("jules-") || normalizedProvider.startsWith("jules_")) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        class={className}
        aria-label={title}
      >
        {title && <title>{title}</title>}
        <rect x="2" y="2" width="20" height="20" rx="5" fill="#00E0A0" />
        <path
          d="M14 7v8c0 1.5-0.8 2.5-2 2.5S10 16.5 10 15"
          stroke="white"
          stroke-width="2.5"
          stroke-linecap="round"
          fill="none"
        />
      </svg>
    );
  }

  if (normalizedProvider.includes("antigravity")) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        class={className}
        aria-label={title}
      >
        {title && <title>{title}</title>}
        <rect x="2" y="2" width="20" height="20" rx="5" fill="#7C3AED" />
        <path
          d="M12 6l-4 7h3.5v5l4.5-8H12.5V6z"
          fill="white"
        />
      </svg>
    );
  }

  if (normalizedProvider.includes("qwen")) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        class={className}
        aria-label={title}
      >
        {title && <title>{title}</title>}
        <rect x="2" y="2" width="20" height="20" rx="5" fill="#6366F1" />
        <circle cx="11" cy="11" r="4.5" stroke="white" stroke-width="2" fill="none" />
        <path d="M14.5 14.5L18 18" stroke="white" stroke-width="2" stroke-linecap="round" />
      </svg>
    );
  }

  if (normalizedProvider.includes("opencode")) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        class={className}
        aria-label={title}
      >
        {title && <title>{title}</title>}
        <rect x="2" y="2" width="20" height="20" rx="5" fill="#F59E0B" />
        <path
          d="M9 8L5 12l4 4M15 8l4 4-4 4"
          stroke="white"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    );
  }

  return <Bot size={size} className={`text-slate-500 ${className}`} />;
};
