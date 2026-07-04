import { h } from "preact";
import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Zap, RefreshCcw, WifiOff } from "lucide-preact";
import gsap from "gsap";
import type { TransportState } from "../../../lib/realtime/dashboard-realtime-client.js";
import { useReducedMotion, useResolvedMotionDuration } from "../../hooks/use-reduced-motion.js";
import { INTERACTION_TOKENS } from "../../lib/motion/tokens.js";
import {
  deriveLiveTransportBannerViewModel,
  type LiveTransportBannerViewModel,
} from "../../lib/live-session-view-model.js";

const LIVE_SNAPSHOT_STALE_MS = 60_000;

export interface LiveTransportBannerProps {
  transportState: TransportState;
  isRecovering: boolean;
  snapshotUpdatedAt: string | null;
  error: string | null;
  viewModel?: LiveTransportBannerViewModel | null;
}

export const LiveTransportBanner: FunctionComponent<LiveTransportBannerProps> = ({
  transportState,
  isRecovering,
  snapshotUpdatedAt,
  error,
  viewModel,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isReducedMotion = useReducedMotion();
  const enterDuration = useResolvedMotionDuration(parseFloat(INTERACTION_TOKENS.enterExit.duration) / 1000);
  const [shouldRender, setShouldRender] = useState(false);
  const derivedBannerState = deriveLiveTransportBannerViewModel({ transportState, isRecovering, error });
  const snapshotAgeMs = snapshotUpdatedAt ? Date.now() - new Date(snapshotUpdatedAt).getTime() : null;
  const staleSnapshotState: LiveTransportBannerViewModel | null = (
    !derivedBannerState
    && transportState === "connected"
    && snapshotAgeMs !== null
    && Number.isFinite(snapshotAgeMs)
    && snapshotAgeMs > LIVE_SNAPSHOT_STALE_MS
  ) ? {
    isVisible: true,
    title: "Stale Data",
    message: "Live runtime content is still visible, but the latest snapshot is more than a minute old.",
    wrapperClass: "bg-status-amber/10 border-status-amber/20 text-status-amber",
    iconClass: "text-status-amber",
    icon: "reconnecting",
    isUrgent: false,
    ariaLive: "polite",
    role: "status",
    ariaBusy: false,
  } : null;
  const refreshingState: LiveTransportBannerViewModel | null = (
    !derivedBannerState
    && transportState === "connected"
    && isRecovering
    && snapshotUpdatedAt
  ) ? {
    isVisible: true,
    title: "Refreshing Live Data",
    message: "Keeping the current runtime snapshot visible while the live stream catches up.",
    wrapperClass: "bg-signal-500/10 border-signal-500/20 text-signal-700 dark:text-signal-300",
    iconClass: "text-signal-600 dark:text-signal-300",
    icon: "reconnecting",
    isUrgent: false,
    ariaLive: "polite",
    role: "status",
    ariaBusy: true,
  } : null;
  const bannerState = viewModel ?? derivedBannerState ?? refreshingState ?? staleSnapshotState;
  const isVisible = bannerState?.isVisible === true;

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
  }, [isVisible, shouldRender, isReducedMotion, enterDuration]);

  const icon = bannerState?.icon === "error"
    ? <Zap className="w-5 h-5 shrink-0" aria-hidden="true" />
    : bannerState?.icon === "reconnecting"
      ? <RefreshCcw className="w-5 h-5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
      : <WifiOff className="w-5 h-5 shrink-0" aria-hidden="true" />;

  return (
    <div
      ref={containerRef}
      className={shouldRender && bannerState ? `flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl border backdrop-blur-md overflow-hidden ${bannerState.wrapperClass}` : "overflow-hidden hidden"}
      role={bannerState?.role ?? "status"}
      aria-live={bannerState?.ariaLive ?? "polite"}
      aria-atomic="true"
      aria-busy={bannerState?.ariaBusy ?? isRecovering}
      style={{ padding: isReducedMotion && isVisible ? "16px 20px" : 0, marginBottom: isReducedMotion && isVisible ? 24 : 0 }}
    >
      {shouldRender && bannerState && (
        <>
          <div className={`flex items-center justify-center ${bannerState.iconClass}`}>
            {icon}
            <span className="sr-only">Live transport state: {bannerState.title}</span>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-bold tracking-tight">{bannerState.title}</span>
            <span className="text-sm opacity-90 break-words">{bannerState.message}</span>
          </div>
        </>
      )}
    </div>
  );
};
