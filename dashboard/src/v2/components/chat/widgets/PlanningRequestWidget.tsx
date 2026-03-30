import { type FunctionComponent } from "preact";
import { ChatWidgetFrame, type ExecutionStatus } from "./ChatWidgetFrame.js";
import { ContainerShip } from "../../ui/PlanningShip.js";
import { ChatRuntimeBadge } from "../ChatRuntimeBadge.js";

export interface PlanningRequestWidgetProps {
  status: ExecutionStatus;
  planName: string;
  isDark?: boolean;
}

export const PlanningRequestWidget: FunctionComponent<PlanningRequestWidgetProps> = ({
  status,
  planName,
  isDark = true
}) => {
  return (
    <ChatWidgetFrame
      status={status}
      header={
        <div class="flex items-center gap-2">
          <ChatRuntimeBadge status={status} label={`Planning: ${planName}`} />
          <span>{planName}</span>
        </div>
      }
    >
      <div class="flex flex-col items-center justify-center p-4 min-h-[120px]">
        {status === 'running' || status === 'queued' ? (
          <div class="relative w-full max-w-[200px] h-20 mb-4 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
             <div class="ocean-wave w-full h-full flex items-center justify-center">
               <svg viewBox="-60 -40 120 80" class="w-full h-full transform translate-y-2 ship-bob" aria-hidden="true">
                 {/* @ts-ignore */}
                 <ContainerShip accentColor="#00E0A0" isMoving={status === 'running'} isDark={isDark} />
               </svg>
             </div>
          </div>
        ) : null}

        <div class="text-center text-sm">
          {status === 'queued' && <span class="text-slate-500">Preparing to plan...</span>}
          {status === 'running' && <span class="text-signal-600 dark:text-signal-400 font-medium animate-pulse">Navigating solutions...</span>}
          {status === 'completed' && <span class="text-slate-600 dark:text-slate-400">Plan formulated successfully.</span>}
          {status === 'failed' && <span class="text-red-600 dark:text-red-400 font-medium">Failed to create a plan.</span>}
        </div>
      </div>
    </ChatWidgetFrame>
  );
};
