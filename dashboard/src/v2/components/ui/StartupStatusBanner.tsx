import type { FunctionComponent } from "preact";
import type { RuntimeStartupStateSnapshot } from "../../../../../src/contracts/app-types.js";
import { AlertTriangle, Info } from "lucide-preact";

export interface StartupStatusBannerProps {
  startup?: RuntimeStartupStateSnapshot;
}

export const StartupStatusBanner: FunctionComponent<StartupStatusBannerProps> = ({ startup }) => {
  if (!startup || startup.status === "completed") {
    return null;
  }

  const isFailed = startup.status === "failed";
  const pendingJobs = startup.jobs.filter(j => j.status !== "completed").map(j => j.name);
  const failedJobs = startup.jobs.filter(j => j.status === "failed");

  return (
    <div
      className={`w-full p-4 mb-6 rounded-xl border flex items-start gap-3 shadow-sm ${
        isFailed
          ? "bg-red-50/50 dark:bg-red-900/10 border-red-200 dark:border-red-900/50 text-red-800 dark:text-red-200"
          : "bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-900/50 text-blue-800 dark:text-blue-200"
      }`}
      role="alert"
    >
      <div className="mt-0.5 shrink-0">
        {isFailed ? (
          <AlertTriangle className="w-5 h-5 text-red-500 dark:text-red-400" />
        ) : (
          <Info className="w-5 h-5 text-blue-500 dark:text-blue-400" />
        )}
      </div>
      <div className="flex-1 text-sm">
        <h4 className="font-semibold mb-1">
          {isFailed ? "Startup Failed" : "Warming up"}
        </h4>
        <p className="opacity-90 leading-relaxed">
          {isFailed && failedJobs.length > 0
            ? failedJobs.map((j) => (
                <span key={j.name} className="block">
                  <strong>{j.name}:</strong> {j.error || "Unknown error"}
                </span>
              ))
            : pendingJobs.length > 0
            ? pendingJobs.join(", ")
            : "Background initialization in progress..."}
        </p>
      </div>
    </div>
  );
};
