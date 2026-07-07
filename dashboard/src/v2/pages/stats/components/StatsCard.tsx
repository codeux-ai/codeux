import type { FunctionComponent, ComponentType, ComponentChildren } from "preact";
import styles from "./StatsCard.module.css";
import "../styles/stats-theme.css";

export type StatsCardAccent = "signal" | "amber" | "cyan" | "rose" | "emerald" | "default";
export type StatsCardDensity = "compact" | "comfortable";
export type StatsCardTone = "warm" | "muted";

interface StatsCardProps {
  title: string;
  value: string | number;
  trend?: ComponentChildren;
  icon?: ComponentType<any>;
  description?: ComponentChildren;
  accent?: StatsCardAccent;
  density?: StatsCardDensity;
  tone?: StatsCardTone;
  className?: string;
  isActive?: boolean;
  children?: ComponentChildren;
}

const ACCENT_CLASS_MAP: Record<StatsCardAccent, string> = {
  signal: styles.accentSignal,
  amber: styles.accentAmber,
  cyan: styles.accentCyan,
  rose: styles.accentRose,
  emerald: styles.accentEmerald,
  default: "",
};

const DENSITY_CLASS_MAP: Record<StatsCardDensity, string> = {
  compact: styles.compact,
  comfortable: styles.comfortable,
};

const TONE_CLASS_MAP: Record<StatsCardTone, string> = {
  warm: styles.toneWarm,
  muted: styles.toneMuted,
};

/**
 * Reusable StatsCard primitive for stats surfaces.
 * Supports named accents, density/tone hooks, icon slots, and trend/metadata.
 */
export const StatsCard: FunctionComponent<StatsCardProps> = ({
  title,
  value,
  trend,
  icon: Icon,
  description,
  accent = "default",
  density = "comfortable",
  tone = "warm",
  className = "",
  isActive = false,
  children,
}) => {
  const accentClass = ACCENT_CLASS_MAP[accent];
  const densityClass = DENSITY_CLASS_MAP[density];
  const toneClass = TONE_CLASS_MAP[tone];
  const accessibleParts = [title, String(value)];
  if (typeof description === "string" && description.trim().length > 0) {
    accessibleParts.push(description);
  }
  const accessibleLabel = accessibleParts.join(": ");

  return (
    <article
      aria-label={accessibleLabel}
      data-accent={accent}
      className={`stats-card-flat ${styles.card} ${accentClass} ${densityClass} ${toneClass} ${isActive ? styles.active : ""} ${className}`}
    >
      {/* Header: Title and Trend */}
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <div className={styles.title}>{title}</div>
          {Icon && (
            <div className={styles.iconContainer} aria-hidden="true">
              <Icon className="w-4 h-4" strokeWidth={2.2} />
            </div>
          )}
        </div>
        {trend && <div className={styles.trendContainer}>{trend}</div>}
      </div>

      {/* Body: Primary Value */}
      <div className={styles.valueContainer}>
        <div className={styles.valueRow}>
          <div className={styles.value}>{value}</div>
          {typeof description !== "string" && description && (
            <div className={styles.secondaryValue}>{description}</div>
          )}
        </div>
        
        {typeof description === "string" && (
          <div className={styles.description}>{description}</div>
        )}
      </div>

      {/* Extra Children (e.g. Action Buttons, extra footer elements, or Sparkline) */}
      {children}
    </article>
  );
};
