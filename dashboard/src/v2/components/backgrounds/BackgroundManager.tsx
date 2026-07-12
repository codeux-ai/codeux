import { lazy, Suspense } from "preact/compat";
import type { FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";

const DeepOceanBackground = lazy(() => import("../chat/DeepOceanBackground.js").then((module) => ({
  default: module.DeepOceanBackground,
})));

const NeonDreamsBackground = lazy(() => import("./NeonDreamsBackground.js").then((module) => ({
  default: module.NeonDreamsBackground,
})));

const AuroraBorealisBackground = lazy(() => import("./AuroraBorealisBackground.js").then((module) => ({
  default: module.AuroraBorealisBackground,
})));

const CosmicDustBackground = lazy(() => import("./CosmicDustBackground.js").then((module) => ({
  default: module.CosmicDustBackground,
})));

const EtherealMistBackground = lazy(() => import("./EtherealMistBackground.js").then((module) => ({
  default: module.EtherealMistBackground,
})));

const QuantumFieldBackground = lazy(() => import("./QuantumFieldBackground.js").then((module) => ({
  default: module.QuantumFieldBackground,
})));

export interface BackgroundManagerProps {
  mode: "ANIMATED" | "STATIC";
  animation: string;
  staticColor: string;
  isDark: boolean;
  suspendAnimation?: boolean;
}

export const BackgroundManager: FunctionComponent<BackgroundManagerProps> = ({
  mode,
  animation,
  staticColor,
  isDark,
  suspendAnimation = false,
}) => {
  const [pageVisible, setPageVisible] = useState(() => typeof document === "undefined" || !document.hidden);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibilityChange = (): void => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  if (mode === "STATIC") {
    return (
      <div
        className="fixed inset-0 overflow-hidden"
        style={{ backgroundColor: staticColor, zIndex: 0, contain: "strict" }}
        aria-hidden="true"
      />
    );
  }

  // Hidden tabs release their WebGL context instead of retaining one renderer per
  // dashboard tab. The Nodes workspace also uses this static fallback because a
  // full-screen shader behind a large draggable canvas forces expensive compositor
  // work and can exhaust Chromium tile/GPU memory.
  if (!pageVisible || suspendAnimation) {
    return (
      <div
        data-testid="suspended-dashboard-background"
        className="fixed inset-0 overflow-hidden"
        style={{ backgroundColor: isDark ? "#060a0d" : "#dbe8f8", zIndex: 0, contain: "strict" }}
        aria-hidden="true"
      />
    );
  }

  return (
    <Suspense fallback={<div className="fixed inset-0 bg-[#dbe8f8] dark:bg-[#060a0d] -z-10" />}>
      {animation === "neon-dreams" ? (
        <NeonDreamsBackground forceDark={isDark} />
      ) : animation === "aurora-borealis" ? (
        <AuroraBorealisBackground forceDark={isDark} />
      ) : animation === "cosmic-dust" ? (
        <CosmicDustBackground forceDark={isDark} />
      ) : animation === "ethereal-mist" ? (
        <EtherealMistBackground forceDark={isDark} />
      ) : animation === "quantum-field" ? (
        <QuantumFieldBackground forceDark={isDark} />
      ) : (
        <DeepOceanBackground forceDark={isDark} />
      )}
    </Suspense>
  );
};
