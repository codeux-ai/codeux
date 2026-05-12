import { lazy, Suspense } from "preact/compat";
import type { FunctionComponent } from "preact";

const DeepOceanBackground = lazy(() => import("../chat/DeepOceanBackground.js").then((module) => ({
  default: module.DeepOceanBackground,
})));

const NeonDreamsBackground = lazy(() => import("./NeonDreamsBackground.js").then((module) => ({
  default: module.NeonDreamsBackground,
})));

const AuroraBorealisBackground = lazy(() => import("./AuroraBorealisBackground.js").then((module) => ({
  default: module.AuroraBorealisBackground,
})));

export interface BackgroundManagerProps {
  mode: "ANIMATED" | "STATIC";
  animation: string;
  staticColor: string;
  isDark: boolean;
}

export const BackgroundManager: FunctionComponent<BackgroundManagerProps> = ({ mode, animation, staticColor, isDark }) => {
  if (mode === "STATIC") {
    return (
      <div
        className="fixed inset-0 overflow-hidden"
        style={{ backgroundColor: staticColor, zIndex: 0 }}
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
      ) : (
        <DeepOceanBackground forceDark={isDark} />
      )}
    </Suspense>
  );
};
