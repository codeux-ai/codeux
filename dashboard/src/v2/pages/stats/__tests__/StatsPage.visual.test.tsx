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
    timeline: vi.fn(() => ({ to: vi.fn().mockReturnThis(), fromTo: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis() }))
  }
}));
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/preact';
import { StatsPage } from '../StatsPage.js';
import * as useProjectDataModule from '../../../context/project-data.js';
import * as useStatsPageDataModule from '../use-stats-page-data.js';
vi.mock('../components/system/SystemStudio.js', () => ({
  SystemStudio: (props: { projectId: string }) => <div data-testid="system-studio">{props.projectId}</div>
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

describe('StatsPage visual tests', () => {
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

    vi.spyOn(useStatsPageDataModule, 'useStatsPageData').mockReturnValue({
      stats: {
        usage: { invocationCount: 1, activeTimeMs: 1000, wallTimeMs: 1000, inputTokens: 10, cachedInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 0, totalTokens: 30, reportedInvocationCount: 1, estimatedInvocationCount: 0, unavailableInvocationCount: 0, unsupportedInvocationCount: 0, inputCostUsd: 0, outputCostUsd: 0, cachedInputCostUsd: 0, totalCostUsd: 0 },
        chartSeries: [],
        range: { resolution: 'hour', bucketCount: 1, label: '24h' },
        buckets: [],
        providers: [],
        purposes: [{
          id: 'code_generation',
          label: 'Code Generation',
          lastActivityAt: null,
          usage: {
            invocationCount: 1, activeTimeMs: 1000, wallTimeMs: 1000, inputTokens: 10, cachedInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 0, totalTokens: 30, reportedInvocationCount: 1, estimatedInvocationCount: 0, unavailableInvocationCount: 0, unsupportedInvocationCount: 0, inputCostUsd: 0, outputCostUsd: 0, cachedInputCostUsd: 0, totalCostUsd: 0
          }
        }],
        tokenSources: [],
        activeSprint: null
      } as any,
      loading: false,
      error: null,
      refresh: vi.fn(),
      usage: {
        invocationCount: 1, activeTimeMs: 1000, wallTimeMs: 1000, inputTokens: 10, cachedInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 0, totalTokens: 30, reportedInvocationCount: 1, estimatedInvocationCount: 0, unavailableInvocationCount: 0, unsupportedInvocationCount: 0, inputCostUsd: 0, outputCostUsd: 0, cachedInputCostUsd: 0, totalCostUsd: 0
      },
      tokenSeries: [0, 0, 0],
      activeTimeSeries: [0, 0, 0],
      wallTimeSeries: [0, 0, 0],
      planningUsage: null,
      activeQuery: { window: '24h' },
      customFrom: '2026-01-01',
      setCustomFrom: vi.fn(),
      customTo: '2026-01-02',
      setCustomTo: vi.fn(),
      visualMode: 'composition',
      setVisualMode: vi.fn(),
      chartState: { enabledSeries: {} } as any,
      providerSegments: [],
      sourceSegments: [],
      tokenSegments: [],
      applyPresetWindow: vi.fn(),
      applyCustomRange: vi.fn(),
      completionConfidence: '100%'
    });
  });

  it('renders StatsPage with composition cards in the top row', () => {
    const { getByText } = render(<StatsPage />);
    expect(getByText('Active Providers')).toBeTruthy();
    expect(getByText('Top Provider')).toBeTruthy();
    expect(getByText('Input Tokens')).toBeTruthy();
    expect(getByText('Output Tokens')).toBeTruthy();
  });

  it('renders empty states with new amber visual language', () => {
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
    expect(getByText('Select a project')).toBeTruthy();
    expect(queryByText('Time-series and throughput analysis')).toBeNull();
  });

  it('renders the system studio without crashing', () => {
    vi.spyOn(useStatsPageDataModule, 'useStatsPageData').mockReturnValueOnce({
      stats: {
        usage: { invocationCount: 1, activeTimeMs: 1000, wallTimeMs: 1000, inputTokens: 10, cachedInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 0, totalTokens: 30, reportedInvocationCount: 1, estimatedInvocationCount: 0, unavailableInvocationCount: 0, unsupportedInvocationCount: 0, inputCostUsd: 0, outputCostUsd: 0, cachedInputCostUsd: 0, totalCostUsd: 0 },
        chartSeries: [],
        range: { resolution: 'hour', bucketCount: 1, label: '24h' },
        buckets: [],
        providers: [],
        purposes: [{
          id: 'code_generation',
          label: 'Code Generation',
          lastActivityAt: null,
          usage: {
            invocationCount: 1, activeTimeMs: 1000, wallTimeMs: 1000, inputTokens: 10, cachedInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 0, totalTokens: 30, reportedInvocationCount: 1, estimatedInvocationCount: 0, unavailableInvocationCount: 0, unsupportedInvocationCount: 0, inputCostUsd: 0, outputCostUsd: 0, cachedInputCostUsd: 0, totalCostUsd: 0
          }
        }],
        tokenSources: [],
        activeSprint: null
      } as any,
      loading: false,
      error: null,
      refresh: vi.fn(),
      usage: {
        invocationCount: 1, activeTimeMs: 1000, wallTimeMs: 1000, inputTokens: 10, cachedInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 0, totalTokens: 30, reportedInvocationCount: 1, estimatedInvocationCount: 0, unavailableInvocationCount: 0, unsupportedInvocationCount: 0, inputCostUsd: 0, outputCostUsd: 0, cachedInputCostUsd: 0, totalCostUsd: 0
      },
      tokenSeries: [0, 0, 0],
      activeTimeSeries: [0, 0, 0],
      wallTimeSeries: [0, 0, 0],
      planningUsage: null,
      activeQuery: { window: '24h' },
      customFrom: '2026-01-01',
      setCustomFrom: vi.fn(),
      customTo: '2026-01-02',
      setCustomTo: vi.fn(),
      visualMode: 'system',
      setVisualMode: vi.fn(),
      chartState: { enabledSeries: {} } as any,
      providerSegments: [],
      sourceSegments: [],
      tokenSegments: [],
      applyPresetWindow: vi.fn(),
      applyCustomRange: vi.fn(),
      completionConfidence: '100%'
    });

    const { getByTestId } = render(<StatsPage />);
    expect(getByTestId('system-studio')).toBeTruthy();
  });
});
