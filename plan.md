1.  **Refactor ProviderSharePieCharts and ProviderUsageCard:**
    - Update `dashboard/src/v2/components/stats/ProviderSharePieCharts.tsx` to handle the `providerSegments` and render richer provider distribution pie charts. This is to "include more detailed breakdowns (for example share by provider plus secondary split such as model or category when data exists)" according to the spec. We will create two pie charts: one for Source Mix and one for Provider Share, which is already somewhat defined in `StatsShared.tsx`. Wait, let's look at what data is actually available for "secondary split such as model or category". Looking at `ProjectExecutionStatsSnapshot`, there are `stats.providers`, but model information is likely in `tokenSources` (or there's no model, so we stick to what we have). I will look at the exact props again.
    - Create `dashboard/src/v2/components/stats/ProviderUsageCard.tsx` that will use `SignalMetricCard` to display top providers when in Providers Mode.

2.  **Implement Aggregation Logic:**
    - Update `dashboard/src/v2/lib/stats/provider-aggregation.ts` to implement `aggregateTopProviders(stats)`.
    - Write tests for this logic in `tests/dashboard/stats/provider-aggregation.test.ts`.

3.  **Update StatsTopCardsGrid to use ProviderUsageCard:**
    - Add a new block in `StatsTopCardsGrid` for `visualMode === "providers"`.
    - This block will use `aggregateTopProviders` to get the top 4 providers and map them to `ProviderUsageCard`. If fewer than 4 exist, it only renders available ones.

4.  **Update StatsShared.tsx (ProvidersStudio):**
    - Replace the current hardcoded charts inside `ProvidersStudio` with `<ProviderSharePieCharts>`. Or, I will just directly update `ProviderSharePieCharts` to be the richer component.

5.  **Write / Update test for StatsPage:**
    - Update `tests/dashboard/stats/StatsPage.providers.test.tsx` to ensure `visualMode === 'providers'` correctly shows the Provider cards and pie charts.

6.  **Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.**

7.  **Submit the change.**
