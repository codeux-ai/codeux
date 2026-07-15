import type { FunctionComponent } from "preact";
import { useMemo } from "preact/hooks";
import type { ProjectExecutionStatsSnapshot } from "../../../../types.js";
import { deriveCostAnalyticsViewModel } from "../../cost-insights.js";
import { CostAllocationPanels } from "./CostAllocationPanels.js";
import { CostEntityLedgers } from "./CostEntityLedgers.js";
import { CostOverviewPanel } from "./CostOverviewPanel.js";
import { useStatsI18n } from "../../stats-i18n.js";

export interface CostStudioProps {
  stats: ProjectExecutionStatsSnapshot;
}

export const CostStudio: FunctionComponent<CostStudioProps> = ({ stats }) => {
  const { text } = useStatsI18n();
  const viewModel = useMemo(() => deriveCostAnalyticsViewModel(stats), [stats]);

  return (
    <section className="grid min-w-0 gap-6" aria-label={text("costAnalysisStudio")}>
      <CostOverviewPanel viewModel={viewModel} />
      <CostAllocationPanels
        totalSpend={viewModel.totalSpend}
        totalTokens={viewModel.tokens}
        tokenSegments={viewModel.tokenSegments}
        spendSegments={viewModel.spendSegments}
        models={viewModel.models}
        purposes={viewModel.purposes}
      />
      <CostEntityLedgers
        tasks={viewModel.tasks}
        sprints={viewModel.sprints}
        averageCostPerTask={viewModel.averageCostPerTask}
        averageCostPerSprint={viewModel.averageCostPerSprint}
      />
    </section>
  );
};
