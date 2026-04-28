import type { FunctionComponent, ComponentType, ComponentChildren } from "preact";
import { WaveFluid } from "../../../components/ui/WaveFluid.js";
import { BorderTrace } from "../../../components/ui/BorderTrace.js";
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

const ACCENT_HEX_MAP: Record<StatsCardAccent, string> = {
  signal: "#00E0A0",
  amber: "#FFB800",
  cyan: "#0EA5E9",
  rose: "#F43F5E",
  emerald: "#10B981",
  default: "#00E0A0",
};

const ACCENT_CLASS_MAP: Record<StatsCardAccent, string> = {
  signal: styles.accentSignal,
  amber: styles.accentAmber,
  cyan: styles.accentCyan,
  rose: styles.accentRose,
  emerald: styles.accentEmerald,
  default: "",
};

/**
 * Reusable StatsCard primitive with award-grade styling.
 * Supports multiple accents, icon slots, and trend/metadata.
 */
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
  const accentHex = ACCENT_HEX_MAP[accent];
  const accentClass = ACCENT_CLASS_MAP[accent];

  return (
    <div className={`${styles.card} ${accentClass} ${className} group`}>
      {/* Background Tint */}
      <div className={styles.tint} />
      
      {/* Animated Visual Foundations */}
      <WaveFluid accentHex={accentHex} isActive={isActive} />
      <BorderTrace accentHex={accentHex} />

      {/* Header: Title and Icon */}
      <div className={styles.header}>
        <div className={styles.title}>{title}</div>
        {Icon && (
          <div className={styles.iconContainer}>
            <Icon className="w-4 h-4" strokeWidth={2.2} />
          </div>
        )}
      </div>

      {/* Body: Primary Value */}
      <div className={styles.valueContainer}>
        <div className={styles.value}>{value}</div>
        
        {/* Footer: Trend and Description */}
        {(trend || description) && (
          <div className={styles.footer}>
            {trend && <div className={styles.trendContainer}>{trend}</div>}
            {description && <div className={styles.description}>{description}</div>}
          </div>
        )}
      </div>

      {/* Extra Children (e.g. Action Buttons or Chips) */}
      {children}
    </div>
  );
};
