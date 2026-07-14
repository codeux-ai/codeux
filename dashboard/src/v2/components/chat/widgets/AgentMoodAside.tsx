import { type FunctionComponent } from "preact";
import { selectAgentHumorMessage } from "../../../lib/agent-humor-messages.js";
import type { DashboardLocale } from "../../../i18n/locales.js";
import { useDashboardI18n } from "../../../i18n/context.js";
import { chatMessages } from "../../../i18n/messages/chat.js";

const EXPLICIT_MOOD_METADATA_KEYS = ["moodComment", "thinkingLine", "pmAside"] as const;
const MAX_MOOD_ASIDE_LENGTH = 180;
const UNSAFE_MOOD_ASIDE_PATTERN = /\b(?:asshole|bastard|crap|damn|dumb|garbage|hate|hell|idiot|kill|loser|moron|stupid|sucks|trash|worthless)\b/i;

export interface ResolveAgentMoodAsideOptions {
  metadata?: Record<string, unknown> | null;
  seed: string;
  locale?: DashboardLocale;
}

export interface AgentMoodAsideProps {
  text: string | null | undefined;
  ariaLabel?: string;
  className?: string;
}

const normalizeMoodAsideText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.replace(/\s+/g, " ").trim();
  if (!text || UNSAFE_MOOD_ASIDE_PATTERN.test(text)) {
    return null;
  }

  if (text.length <= MAX_MOOD_ASIDE_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_MOOD_ASIDE_LENGTH - 3).trimEnd()}...`;
};

export const buildAgentMoodAsideSeed = (parts: readonly unknown[]): string => (
  parts
    .map((part) => {
      if (part === null || part === undefined) {
        return "";
      }
      return String(part);
    })
    .join("|")
);

export const resolveAgentMoodAsideText = ({
  metadata,
  seed,
  locale = "en",
}: ResolveAgentMoodAsideOptions): string => {
  for (const key of EXPLICIT_MOOD_METADATA_KEYS) {
    const explicitText = normalizeMoodAsideText(metadata?.[key]);
    if (explicitText) {
      return explicitText;
    }
  }

  return selectAgentHumorMessage({
    category: "mood",
    seed,
    nowMs: 0,
    locale,
  });
};

export const AgentMoodAside: FunctionComponent<AgentMoodAsideProps> = ({
  text,
  ariaLabel,
  className = "",
}) => {
  const { translate } = useDashboardI18n();
  const displayText = normalizeMoodAsideText(text);
  if (!displayText) {
    return null;
  }

  return (
    <aside
      role="note"
      aria-label={ariaLabel ?? translate(chatMessages, "projectManagerThought")}
      className={`mt-2 max-w-full overflow-hidden border-l border-slate-300/70 pl-3 text-[13px] italic leading-5 text-slate-500 break-words overflow-wrap-anywhere dark:border-white/15 dark:text-slate-400 ${className}`}
    >
      <span className="font-serif">{displayText}</span>
    </aside>
  );
};
