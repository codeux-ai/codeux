import type { FunctionComponent, ComponentType, ComponentChildren } from "preact";
import styles from "./StatsCard.module.css";
import "../styles/stats-theme.css";

export type StatsCardAccent = "signal" | "amber" | "cyan" | "rose" | "emerald" | "default";

interface StatsCardProps {
  title: string;
  value: string | number;
  trend?: ComponentChildren;
  icon?: ComponentType<any>;
  description?: ComponentChildren;
  accent?: StatsCardAccent;
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

export const StatsCard: FunctionComponent<StatsCardProps> = ({
  title,
  value,
  trend,
  icon: Icon,
  description,
  accent = "default",
  className = "",
  isActive = false,
  children,
}) => {
  const accentClass = ACCENT_CLASS_MAP[accent];

  return (
    <div className={`${styles.card} ${accentClass} ${className} group`}>
      <div className={styles.tint} />

      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <div className={styles.title}>{title}</div>
          {Icon && (
            <div className={styles.iconContainer}>
              <Icon className="w-4 h-4" strokeWidth={2.2} />
            </div>
          )}
        </div>
        {trend && <div className={styles.trendContainer}>{trend}</div>}
      </div>

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

      {children}
    </div>
  );
};
