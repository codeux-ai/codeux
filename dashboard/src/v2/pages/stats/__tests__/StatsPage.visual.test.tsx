/**
 * @vitest-environment jsdom
 */
vi.mock("gsap", () => ({
  default: {
    killTweensOf: vi.fn(),
    fromTo: vi.fn().mockImplementation((el, config) => { if (config?.onComplete) config.onComplete(); }),
    to: vi.fn().mockImplementation((el, config) => { if (config?.onComplete) config.onComplete(); }),
    set: vi.fn(),
    context: vi.fn(() => ({ revert: vi.fn() })),
    registerPlugin: vi.fn(),
    matchMedia: vi.fn(() => ({
      add: vi.fn((query, fn) => fn()),
      revert: vi.fn(),
      kill: vi.fn()
    })),
    timeline: vi.fn(() => ({
      to: vi.fn().mockReturnThis(),
      fromTo: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      kill: vi.fn()
    }))
  }
}));
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/preact';
import { StatsPage } from '../StatsPage.js';
import { AnalysisStudioSection } from '../components/AnalysisStudioSection.js';
import { calculateChartMetrics, groupChartSeries } from '../chart-view-models.js';
import * as useProjectDataModule from '../../../context/project-data.js';
import * as useStatsPageDataModule from '../use-stats-page-data.js';
vi.mock('../components/system/SystemStudio.js', () => ({
  SystemStudio: (props: { projectId: string }) => (
    <section data-testid="system-studio" aria-label="System workbench">
      <h3>System Workbench</h3>
      <div>Invocation Filters</div>
      <div>Invocation Table</div>
      <div>{props.projectId}</div>
    </section>
  )
}));

vi.mock('../../../context/project-data.js', () => {
  const { createContext } = require("preact");
  const ProjectDataContext = createContext(null);
  return {
    ProjectDataContext,
    useProjectData: vi.fn()
  };
});

vi.mock('../use-stats-page-data.js', () => ({
  useStatsPageData: vi.fn()
}));

const usage = {
  invocationCount: 6,
  activeTimeMs: 150_000,
  wallTimeMs: 240_000,
  inputTokens: 1_200,
  cachedInputTokens: 300,
  outputTokens: 800,
  reasoningOutputTokens: 120,
  totalTokens: 2_420,
  reportedInvocationCount: 4,
  estimatedInvocationCount: 1,
  unavailableInvocationCount: 1,
  unsupportedInvocationCount: 0,
  inputCostUsd: 0.012,
  outputCostUsd: 0.02,
  cachedInputCostUsd: 0.001,
  totalCostUsd: 0.033,
};

const makeEntity = (overrides: Record<string, unknown> = {}) => ({
  id: 'entity-1',
  label: 'Entity 1',
  secondaryLabel: null,
  status: null,
  purpose: null,
  provider: null,
  usage,
  lastActivityAt: null,
  ...overrides,
});

function makeStats() {
  return {
    projectId: 'proj-1',
    projectName: 'Project 1',
    window: '24h',
    query: { window: '24h' },
    generatedAt: '2026-01-02T00:00:00.000Z',
    usage,
    chartSeries: [
      { id: 'core_total_tokens', label: 'Total Tokens', grouping: 'totals', defaultEnabled: true, data: [100, 200, 300] },
      { id: 'core_total_cost', label: 'Total Cost', grouping: 'totals', defaultEnabled: false, data: [0.01, 0.02, 0.033] },
      { id: 'provider_codex', label: 'Codex', grouping: 'providers', defaultEnabled: false, data: [80, 160, 240] },
      { id: 'model_codex/gpt-5-codex', label: 'GPT-5 Codex', grouping: 'models', defaultEnabled: false, data: [70, 120, 220] },
      { id: 'purpose_invocations_task_coding', label: 'Task Coding', grouping: 'purposes_invocations', defaultEnabled: false, data: [1, 2, 3] },
      { id: 'git_files_changed', label: 'Files Changed', grouping: 'git', defaultEnabled: false, data: [2, 4, 6] },
      { id: 'git_prs', label: 'PRs', grouping: 'git', defaultEnabled: false, data: [0, 1, 1] },
    ],
    range: { window: '24h', resolution: 'hour', resolutionLabel: 'Hourly', bucketCount: 3, label: '24h', from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z', isCustom: false },
    buckets: [
      { bucketStart: '2026-01-01T00:00:00.000Z', bucketEnd: '2026-01-01T01:00:00.000Z', label: '00:00', usage: { ...usage, totalTokens: 100, activeTimeMs: 30_000, invocationCount: 1, cachedInputTokens: 10, inputTokens: 90 } },
      { bucketStart: '2026-01-01T01:00:00.000Z', bucketEnd: '2026-01-01T02:00:00.000Z', label: '01:00', usage: { ...usage, totalTokens: 200, activeTimeMs: 45_000, invocationCount: 2, cachedInputTokens: 40, inputTokens: 120 } },
      { bucketStart: '2026-01-01T02:00:00.000Z', bucketEnd: '2026-01-01T03:00:00.000Z', label: '02:00', usage: { ...usage, totalTokens: 300, activeTimeMs: 75_000, invocationCount: 3, cachedInputTokens: 80, inputTokens: 180 } },
    ],
    providers: [makeEntity({ id: 'codex', label: 'Codex' })],
    purposes: [makeEntity({ id: 'task_coding', label: 'Task Coding' })],
    models: [{
      id: 'codex/gpt-5-codex',
      provider: 'codex',
      model: 'gpt-5-codex',
      label: 'GPT-5 Codex',
      usage,
      statusCounts: { completed: 5, failed: 1, cancelled: 0, running: 0, paused: 0 },
      successRate: 5 / 6,
      duration: { sampleCount: 6, avgMs: 20_000, p50Ms: 18_000, p95Ms: 35_000, maxMs: 40_000 },
      lastActivityAt: null,
    }],
    tasks: [makeEntity({ id: 'task-1', label: 'Task 1' })],
    sprints: [makeEntity({ id: 'sprint-1', label: 'Sprint 1' })],
    tokenSources: [{ source: 'reported', count: 4 }, { source: 'estimated', count: 1 }],
    activeSprint: { sprintId: 'sprint-1', sprintName: 'Sprint 1', sprintNumber: 1 },
    git: {
      totals: { insertions: 120, deletions: 40, filesChanged: 6, prCount: 1, mergedCount: 1, mergeConflictCount: 1 },
      buckets: [],
      tasks: [],
      sprints: [],
    },
    mergeConflictCount: 1,
    statusCounts: { completed: 5, failed: 1, cancelled: 0, running: 0, paused: 0 },
    duration: { sampleCount: 6, avgMs: 20_000, p50Ms: 18_000, p95Ms: 35_000, maxMs: 40_000 },
  } as any;
}

function makeChartState(stats = makeStats()) {
  const enabledSeries = stats.chartSeries.reduce((acc: Record<string, boolean>, series: { id: string; defaultEnabled: boolean }) => {
    acc[series.id] = series.defaultEnabled;
    return acc;
  }, {});
  const seriesGroups = groupChartSeries(stats.chartSeries, enabledSeries);

  return {
    visualMode: 'composition',
    setVisualMode: vi.fn(),
    zoomRange: null,
    setZoomRange: vi.fn(),
    hoveredIndex: null,
    setHoveredIndex: vi.fn(),
    dragStartIndex: null,
    setDragStartIndex: vi.fn(),
    dragCurrentIndex: null,
    setDragCurrentIndex: vi.fn(),
    enabledSeries,
    setEnabledSeries: vi.fn(),
    resetEnabledSeries: vi.fn(),
    activeSeriesCount: seriesGroups.reduce((count, group) => count + group.activeCount, 0),
    seriesGroups,
    metrics: calculateChartMetrics(stats.buckets),
  };
}

function mockStatsPageData(visualMode: 'trend' | 'composition' | 'models' | 'reliability' | 'ledgers' | 'system') {
  const stats = makeStats();

  vi.spyOn(useStatsPageDataModule, 'useStatsPageData').mockReturnValue({
    stats,
    loading: false,
    error: null,
    refresh: vi.fn(),
    usage,
    tokenSeries: [100, 200, 300],
    activeTimeSeries: [30_000, 45_000, 75_000],
    wallTimeSeries: [60_000, 80_000, 100_000],
    planningUsage: null,
    activeQuery: { window: '24h' },
    customFrom: '2026-01-01',
    setCustomFrom: vi.fn(),
    customTo: '2026-01-02',
    setCustomTo: vi.fn(),
    applyCustomWindow: vi.fn(),
    visualMode,
    setVisualMode: vi.fn(),
    chartState: makeChartState(stats) as any,
    providerSegments: [{ label: 'Codex', value: usage.totalTokens, color: '#D99A12', textClassName: 'text-amber-600' }],
    sourceSegments: [{ label: 'reported', value: 4, color: '#00E0A0', textClassName: 'text-signal-600' }],
    tokenSegments: [{ label: 'Input', value: usage.inputTokens, color: '#00E0A0', textClassName: 'text-signal-600' }],
    applyPresetWindow: vi.fn(),
    applyCustomRange: vi.fn(),
    completionConfidence: '83%'
  });
}

describe('StatsPage visual tests', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.spyOn(useProjectDataModule, 'useProjectData').mockReturnValue({
      selectedProjectId: 'proj-1',
      createProject: vi.fn(),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
      selectedProject: { id: 'proj-1', name: 'Project 1' } as any,
      projects: [],
      loading: false,
      error: null,
      refreshProjects: vi.fn(),
      selectProject: vi.fn(),

    });

    mockStatsPageData('composition');
  });

  it.each([
    ['trend', 'Trend', ['Total Tokens', 'Active Time', 'Cost', 'Invocations', 'Cache Rate']],
    ['composition', 'Composition', ['Provider Share', 'Token Anatomy', 'Purpose Activity', 'Merge Conflicts']],
    ['models', 'Models', ['Active Models', 'Top Model', 'Median Latency', 'Success Rate', 'Cache Hit Rate']],
    ['reliability', 'Reliability', ['Provider Health', 'Telemetry Mix', 'Failures', 'Retry Signals', 'Telemetry Gaps']],
    ['ledgers', 'Ledgers', ['Task Rows', 'Sprint Rows', 'Pull Requests', 'Files Changed', 'Merge Conflicts']],
    ['system', 'System', ['Invocation Rows', 'Provider Rows', 'Model Rows', 'Source Rows', 'System Health']],
  ] as const)('renders %s mode top cards and studio shell', (mode, studioTitle, labels) => {
    mockStatsPageData(mode);
    const { getAllByText } = render(<StatsPage />);
    for (const label of labels) {
      expect(getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('region', { name: 'Statistics' })).toBeTruthy();
    expect(screen.getByRole('region', { name: `${studioTitle === 'Reliability' ? 'Providers' : studioTitle} metrics` })).toBeTruthy();
    expect(screen.queryByText('Analysis Studio')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Analysis workspace' })).toBeNull();
  });

  it('renders flat analysis metadata before the active studio content', () => {
    mockStatsPageData('composition');

    render(<StatsPage />);

    const analysisPanel = screen.getByRole('region', { name: 'Stats analysis panel' });
    expect(within(analysisPanel).getByText('Usage mix')).toBeTruthy();
    expect(within(analysisPanel).getAllByText('Composition').length).toBeGreaterThan(0);
    expect(within(analysisPanel).getByText('Provider, token, purpose, and source mix for the current telemetry window.')).toBeTruthy();
  });

  it('renders the Waiting for Telemetry empty state as a flat status panel', () => {
    render(
      <AnalysisStudioSection
        stats={null}
        loading={false}
        error={null}
        refresh={vi.fn()}
        projectId="proj-1"
        planningUsage={null}
        providerSegments={[]}
        tokenSegments={[]}
        sourceSegments={[]}
        visualMode="trend"
        setVisualMode={vi.fn()}
        chartState={makeChartState() as any}
      />,
    );

    expect(screen.getByRole('region', { name: 'Stats analysis panel' })).toHaveTextContent('Time-series lens');
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for Telemetry');
    expect(screen.getByRole('status')).toHaveTextContent('Select a time window to see Trend data.');
  });

  it('renders the no-project state in the stats shell hierarchy', () => {
    vi.mocked(useProjectDataModule.useProjectData).mockReturnValue({
      selectedProjectId: null,
      createProject: vi.fn(),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
      selectedProject: null,
      projects: [],
      loading: false,
      error: null,
      refreshProjects: vi.fn(),
      selectProject: vi.fn(),
    } as any);
    vi.mocked(useStatsPageDataModule.useStatsPageData).mockReturnValue({
      stats: null,
      loading: false,
      error: null,
      refresh: vi.fn(),
      usage: null as any,
      tokenSeries: [],
      activeTimeSeries: [],
      wallTimeSeries: [],
      planningUsage: null,
      activeQuery: { window: '24h' },
      customFrom: '2026-01-01',
      setCustomFrom: vi.fn(),
      customTo: '2026-01-02',
      setCustomTo: vi.fn(),
      visualMode: 'trend',
      setVisualMode: vi.fn(),
      chartState: { enabledSeries: {} } as any,
      providerSegments: [],
      sourceSegments: [],
      tokenSegments: [],
      applyPresetWindow: vi.fn(),
      applyCustomRange: vi.fn(),
      completionConfidence: '100%'
    });

    const { getByText, queryByText } = render(<StatsPage />);
    expect(screen.getByRole('region', { name: 'Statistics' })).toBeTruthy();
    expect(screen.queryByLabelText('Stats workspace context')).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'No project selected' })).toBeTruthy();
    expect(getByText('Stats panel idle')).toBeTruthy();
    expect(getByText('Project · No project selected')).toBeTruthy();
    expect(queryByText('Time-series and throughput analysis')).toBeNull();
  });

  it('renders the loading state as a polite stats shell panel', () => {
    vi.mocked(useStatsPageDataModule.useStatsPageData).mockReturnValue({
      stats: null,
      loading: true,
      error: null,
      refresh: vi.fn(),
      usage: null as any,
      tokenSeries: [],
      activeTimeSeries: [],
      wallTimeSeries: [],
      planningUsage: null,
      activeQuery: { window: '24h' },
      customFrom: '2026-01-01',
      setCustomFrom: vi.fn(),
      customTo: '2026-01-02',
      setCustomTo: vi.fn(),
      visualMode: 'trend',
      setVisualMode: vi.fn(),
      chartState: { enabledSeries: {} } as any,
      providerSegments: [],
      sourceSegments: [],
      tokenSegments: [],
      applyPresetWindow: vi.fn(),
      applyCustomRange: vi.fn(),
      completionConfidence: '100%'
    });

    render(<StatsPage />);

    expect(screen.getByText(/^Generated · Loading snapshot$/i)).toBeTruthy();
    expect(screen.queryByLabelText('Stats workspace context')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Loading telemetry field');
    expect(screen.getByRole('status')).toHaveTextContent('Stats panel refreshing');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('renders the error state as an alert panel with recovery action', () => {
    const refresh = vi.fn();
    vi.mocked(useStatsPageDataModule.useStatsPageData).mockReturnValue({
      stats: null,
      loading: false,
      error: 'Stats fetch failed.',
      refresh,
      usage: null as any,
      tokenSeries: [],
      activeTimeSeries: [],
      wallTimeSeries: [],
      planningUsage: null,
      activeQuery: { window: '24h' },
      customFrom: '2026-01-01',
      setCustomFrom: vi.fn(),
      customTo: '2026-01-02',
      setCustomTo: vi.fn(),
      visualMode: 'trend',
      setVisualMode: vi.fn(),
      chartState: { enabledSeries: {} } as any,
      providerSegments: [],
      sourceSegments: [],
      tokenSegments: [],
      applyPresetWindow: vi.fn(),
      applyCustomRange: vi.fn(),
      completionConfidence: '100%'
    });

    render(<StatsPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('Stats panel unavailable');
    expect(screen.getByRole('alert')).toHaveTextContent('Stats fetch failed.');
    expect(screen.getByRole('alert')).toHaveTextContent('Project · Project 1');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByText(/^Generated · No snapshot$/i)).toBeTruthy();
  });

  it('renders the system studio without crashing', () => {
    mockStatsPageData('system');

    const { getByTestId, getByText } = render(<StatsPage />);
    expect(getByTestId('system-studio')).toBeTruthy();
    expect(getByText('Invocation Filters')).toBeTruthy();
    expect(getByText('Invocation Table')).toBeTruthy();
  });

  it('exposes every stats mode in the hero segmented control', () => {
    mockStatsPageData('composition');

    render(<StatsPage />);

    expect(screen.getAllByLabelText('Stats command controls').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText('Stats active lens')).toHaveTextContent('Composition');
    expect(screen.getByLabelText('Stats project context')).toHaveTextContent('Project');
    expect(screen.getByRole('group', { name: 'Time window presets' })).toBeTruthy();

    const modeGroup = screen.getByRole('group', { name: 'Analytics modes' });
    const expectedModes = [
      ['Trend', 'false'],
      ['Composition', 'true'],
      ['Models', 'false'],
      ['Providers', 'false'],
      ['Ledgers', 'false'],
      ['System', 'false'],
    ] as const;

    for (const [label, pressed] of expectedModes) {
      expect(within(modeGroup).getByRole('button', { name: label })).toHaveAttribute('aria-pressed', pressed);
    }
  });

  it('keeps the stats hero command band on flat primitives without depth or glass gradients', () => {
    const css = readFileSync(join(process.cwd(), 'dashboard/src/v2/pages/stats/StatsPage.module.css'), 'utf8');
    const heroPanelRule = css.match(/\.heroPanel\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? '';
    const heroControlsRule = css.match(/\.heroControls\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? '';
    const heroControlSectionRule = css.match(/\.heroControlSection\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? '';
    const heroPresetButtonActiveRule = css.match(/\.heroPresetButtonActive\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? '';
    const stateMessageIconRule = css.match(/\.stateMessageIcon\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? '';

    expect(heroPanelRule).toContain('background: var(--stats-surface-panel)');
    expect(heroPanelRule).not.toContain('box-shadow');
    expect(heroControlsRule).toContain('background: var(--stats-surface-subpanel)');
    expect(heroPresetButtonActiveRule).toContain('background: var(--stats-surface-control-active-strong)');
    expect(stateMessageIconRule).toContain('background: var(--stats-surface-chip)');
    expect(heroPanelRule).not.toContain('linear-gradient');
    expect(heroControlsRule).not.toContain('linear-gradient');
    expect(heroControlSectionRule).not.toMatch(/border:\s*1px/);
    expect(heroControlSectionRule).not.toMatch(/background:/);
    expect(css).not.toContain('backdrop-blur');
    expect(css).not.toContain('var(--surface-glass)');
    expect(css).not.toContain('var(--elevation-base)');
    expect(css).not.toContain('translateY(-1px)');
  });

  it('keeps shared stats shell sources free of old glass and lift tokens', () => {
    const sourceByPath = {
      'StatsPage.module.css': readFileSync(join(process.cwd(), 'dashboard/src/v2/pages/stats/StatsPage.module.css'), 'utf8'),
      'stats-theme.css': readFileSync(join(process.cwd(), 'dashboard/src/v2/pages/stats/styles/stats-theme.css'), 'utf8'),
      'stats-ui-primitives.tsx': readFileSync(join(process.cwd(), 'dashboard/src/v2/pages/stats/components/stats-ui-primitives.tsx'), 'utf8'),
    };

    const forbiddenPatterns = [
      /backdrop-blur/,
      /surface-glass/,
      /linear-gradient/,
      /drop-shadow/,
      /hover:-?translate/,
      /hover:scale/,
      /translateY\(/,
      /scale\(/,
      /var\(--elevation-/,
    ];

    for (const [sourcePath, source] of Object.entries(sourceByPath)) {
      for (const pattern of forbiddenPatterns) {
        expect(source, `${sourcePath} should not include ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
