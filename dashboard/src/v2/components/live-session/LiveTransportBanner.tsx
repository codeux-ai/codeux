import { h } from "preact";
import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Zap, RefreshCcw, WifiOff } from "lucide-preact";
import gsap from "gsap";
import type { TransportState } from "../../../lib/realtime/dashboard-realtime-client.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import {
  deriveLiveTransportBannerViewModel,
  type LiveTransportBannerViewModel,
} from "../../lib/live-session-view-model.js";

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
  const motionTokens = useGsapInteractionTokens();
  const [shouldRender, setShouldRender] = useState(false);
  const derivedBannerState = deriveLiveTransportBannerViewModel({ transportState, isRecovering, error, snapshotUpdatedAt });
  const bannerState = viewModel ?? derivedBannerState;
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
          { height: "auto", opacity: 1, marginBottom: 24, padding: "16px 20px", duration: motionTokens.enterExit.duration, ease: motionTokens.enterExit.ease, overwrite: "auto" }
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
          duration: motionTokens.enterExit.duration,
          ease: motionTokens.enterExit.ease,
          overwrite: "auto",
          onComplete: () => setShouldRender(false)
        });
      }
    }
  }, [isVisible, shouldRender, isReducedMotion, motionTokens.enterExit.duration, motionTokens.enterExit.ease]);

  const icon = bannerState?.icon === "error"
    ? <Zap className="w-5 h-5 shrink-0 motion-reduce:rounded-full motion-reduce:ring-2 motion-reduce:ring-current/25" aria-hidden="true" />
    : bannerState?.icon === "reconnecting"
      ? <RefreshCcw className="w-5 h-5 shrink-0 motion-safe:animate-spin motion-reduce:rounded-full motion-reduce:ring-2 motion-reduce:ring-current/25" aria-hidden="true" />
      : <WifiOff className="w-5 h-5 shrink-0 motion-reduce:rounded-full motion-reduce:ring-2 motion-reduce:ring-current/25" aria-hidden="true" />;

  return (
    <div
      ref={containerRef}
      className={shouldRender && bannerState ? `flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl border backdrop-blur-md overflow-hidden ${bannerState.wrapperClass}` : "overflow-hidden hidden"}
      role={shouldRender && bannerState ? bannerState.role : undefined}
      aria-live={shouldRender && bannerState ? bannerState.ariaLive : undefined}
      aria-atomic={shouldRender && bannerState ? "true" : undefined}
      aria-busy={shouldRender && bannerState ? bannerState.ariaBusy : undefined}
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
