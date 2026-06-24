import { h } from "preact";
import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Zap, RefreshCcw, WifiOff } from "lucide-preact";
import gsap from "gsap";
import type { TransportState } from "../../../lib/realtime/dashboard-realtime-client.js";
import { useReducedMotion, useResolvedMotionDuration } from "../../hooks/use-reduced-motion.js";
import { INTERACTION_TOKENS } from "../../lib/motion/tokens.js";

export interface LiveTransportBannerProps {
  transportState: TransportState;
  isRecovering: boolean;
  snapshotUpdatedAt: string | null;
  error: string | null;
}

export const LiveTransportBanner: FunctionComponent<LiveTransportBannerProps> = ({
  transportState,
  error,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isReducedMotion = useReducedMotion();
  const enterDuration = useResolvedMotionDuration(parseFloat(INTERACTION_TOKENS.enterExit.duration) / 1000);
  const [shouldRender, setShouldRender] = useState(false);
  const isVisible = !!error || transportState === "disconnected" || transportState === "reconnecting";

  useLayoutEffect(() => {
    if (isVisible && !shouldRender) {
      setShouldRender(true);
    }
  }, [isVisible, shouldRender]);

  useLayoutEffect(() => {
    if (!containerRef.current) return;

    if (isVisible) {
      if (isReducedMotion) {
        gsap.set(containerRef.current, { height: "auto", opacity: 1, marginBottom: 24, padding: "16px 20px" });
      } else {
        gsap.killTweensOf(containerRef.current);
        gsap.fromTo(containerRef.current,
          { height: 0, opacity: 0, marginBottom: 0, padding: 0 },
          { height: "auto", opacity: 1, marginBottom: 24, padding: "16px 20px", duration: enterDuration, ease: INTERACTION_TOKENS.enterExit.ease, overwrite: "auto" }
        );
      }
    } else if (!isVisible && shouldRender) {
      if (isReducedMotion) {
        setShouldRender(false);
      } else {
        gsap.killTweensOf(containerRef.current);
        gsap.to(containerRef.current, {
          height: 0,
          opacity: 0,
          marginBottom: 0,
          padding: 0,
          duration: enterDuration,
          ease: INTERACTION_TOKENS.enterExit.ease,
          overwrite: "auto",
          onComplete: () => setShouldRender(false)
        });
      }
    }
  }, [isVisible, isReducedMotion, enterDuration]);

  let icon = <WifiOff className="w-5 h-5 shrink-0" />;
  let title = "Disconnected";
  let message = "Lost connection to the live stream. Retrying...";
  let wrapperClass = "bg-status-red/10 border-status-red/20 text-status-red";
  let iconClass = "text-status-red";
  let isUrgent = true;

  if (error) {
    icon = <Zap className="w-5 h-5 shrink-0" />;
    title = "Connection Error";
    message = error;
    wrapperClass = "bg-status-red/10 border-status-red/20 text-status-red";
    iconClass = "text-status-red";
    isUrgent = true;
  } else if (transportState === "reconnecting") {
    icon = <RefreshCcw className="w-5 h-5 shrink-0 animate-spin" />;
    title = "Reconnecting";
    message = "Attempting to restore connection...";
    wrapperClass = "bg-status-amber/10 border-status-amber/20 text-status-amber";
    iconClass = "text-status-amber";
    isUrgent = false;
  }

  return (
    <div
      ref={containerRef}
      className={shouldRender ? `flex items-center gap-4 rounded-2xl border backdrop-blur-md overflow-hidden ${wrapperClass}` : "overflow-hidden"}
      role={isUrgent ? "alert" : "status"}
      aria-live={isUrgent ? "assertive" : "polite"}
      aria-atomic="true"
      style={{ padding: isReducedMotion && isVisible ? "16px 20px" : 0, marginBottom: isReducedMotion && isVisible ? 24 : 0 }}
    >
      {shouldRender && (
        <>
          <div className={`flex items-center justify-center ${iconClass}`}>
            {icon}
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-tight">{title}</span>
            <span className="text-sm opacity-90">{message}</span>
          </div>
        </>
      )}
    </div>
  );
};
