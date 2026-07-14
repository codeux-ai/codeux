import type { FunctionComponent, JSX } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  CalendarDays,
  BellRing,
  Brain,
  Check,
  Clock3,
  ListTodo,
  MessageCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Send,
  Trash2,
  Workflow,
  Zap,
} from "lucide-preact";
import { PageContainer } from "./components/layout/PageContainer.js";
import { PageHeader } from "./components/layout/PageHeader.js";
import { AvantgardeSelect } from "./components/ui/AvantgardeSelect.js";
import { Button } from "./components/ui/Button.js";
import { useProjectData } from "./context/project-data.js";
import { createDashboardFormatters } from "./i18n/formatters.js";
import {
  translateDashboardMessage,
  translateDashboardPlural,
  type DashboardLocale,
  type DashboardMessageVariables,
  type DashboardTextMessageKey,
} from "./i18n/locales.js";
import { schedulerMessages } from "./i18n/messages/scheduler.js";
import { useDashboardI18n } from "./i18n/context.js";
import { subscribeToDashboardRealtime } from "../lib/realtime/dashboard-realtime-client.js";
import { fetchSprints } from "./lib/project-api.js";
import { fetchNodeFlows } from "./lib/node-flow-api.js";
import { fetchQuicksprintTemplates } from "./lib/quicksprint-api.js";
import {
  createSchedulerEntry,
  deleteSchedulerEntry,
  fetchProjectSchedule,
  updateSchedulerEntry,
} from "./lib/scheduler-api.js";
import type {
  CreateSchedulerEntryInput,
  ScheduleAnchor,
  SchedulerCollectionResponse,
  SchedulerEntryRecord,
  SchedulerOccurrence,
  ScheduleRecurrenceRule,
  ScheduleTargetType,
  SprintRecord,
  UpdateSchedulerEntryInput,
  NodeFlowJsonObject,
  NodeFlowJsonValue,
  NodeFlowRecord,
} from "./types.js";
import type { QuicksprintTemplateRecord } from "../../../src/contracts/quicksprint-types.js";

type SchedulerView = "calendar" | "day";
type ScheduleTimingMode = "absolute" | "after_sprint_end";
type OperatorScheduleTargetType = Extract<ScheduleTargetType, "sprint" | "quicksprint" | "chat" | "memory_remediation" | "node_flow">;
type SchedulerFormInput = Omit<UpdateSchedulerEntryInput, "targetType"> & Pick<CreateSchedulerEntryInput, "targetType">;
type FeedbackState = { tone: "idle" | "success" | "error"; message: string | null };

const SCHEDULER_FIELD_CLASS = "scheduler-field rounded-[var(--radius-ui)] border border-[color:var(--color-border-muted)] dark:border-white/[0.06] hover:border-[color:var(--color-border-muted)] dark:hover:border-white/[0.12] bg-white/80 dark:bg-white/[0.05] px-3.5 text-sm font-semibold text-slate-700 dark:text-slate-200 placeholder-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] outline-none transition-all duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] focus:border-signal-500/40 focus:outline-none focus:ring-2 focus:ring-signal-500/20";
const SCHEDULER_COMPACT_FIELD_CLASS = `${SCHEDULER_FIELD_CLASS} min-h-[40px]`;

const TARGET_OPTIONS: Array<{
  value: ScheduleTargetType;
  icon: typeof Zap;
  tone: string;
  activeClassName: string;
  chipClassName: string;
}> = [
  {
    value: "sprint",
    icon: Zap,
    tone: "text-ember-500",
    activeClassName: "border-ember-500/35 bg-ember-500/10 shadow-[0_12px_34px_rgba(255,184,0,0.13)]",
    chipClassName: "bg-ember-500/12 text-ember-600 dark:text-ember-400",
  },
  {
    value: "quicksprint",
    icon: RefreshCw,
    tone: "text-sky-500",
    activeClassName: "border-sky-500/35 bg-sky-500/10 shadow-[0_12px_34px_rgba(14,165,233,0.13)]",
    chipClassName: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
  },
  {
    value: "chat",
    icon: MessageCircle,
    tone: "text-violet-500",
    activeClassName: "border-violet-500/35 bg-violet-500/10 shadow-[0_12px_34px_rgba(139,92,246,0.13)]",
    chipClassName: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  },
  {
    value: "memory_remediation",
    icon: Brain,
    tone: "text-signal-500",
    activeClassName: "border-signal-500/35 bg-signal-500/10 shadow-[0_12px_34px_rgba(0,224,160,0.13)]",
    chipClassName: "bg-signal-500/12 text-signal-600 dark:text-signal-400",
  },
  {
    value: "node_flow",
    icon: Workflow,
    tone: "text-rose-500",
    activeClassName: "border-rose-500/35 bg-rose-500/10 shadow-[0_12px_34px_rgba(244,63,94,0.13)]",
    chipClassName: "bg-rose-500/12 text-rose-600 dark:text-rose-400",
  },
  {
    value: "agent_wakeup",
    icon: BellRing,
    tone: "text-fuchsia-500",
    activeClassName: "border-fuchsia-500/35 bg-fuchsia-500/10 shadow-[0_12px_34px_rgba(217,70,239,0.13)]",
    chipClassName: "bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-400",
  },
  {
    value: "task",
    icon: ListTodo,
    tone: "text-cyan-500",
    activeClassName: "border-cyan-500/35 bg-cyan-500/10 shadow-[0_12px_34px_rgba(6,182,212,0.13)]",
    chipClassName: "bg-cyan-500/12 text-cyan-600 dark:text-cyan-400",
  },
];

const OPERATOR_TARGET_TYPES: OperatorScheduleTargetType[] = ["sprint", "quicksprint", "chat", "memory_remediation", "node_flow"];
const FORM_TARGET_OPTIONS = TARGET_OPTIONS.filter((option) => isOperatorTargetType(option.value));
const targetOptionByType = new Map(TARGET_OPTIONS.map((option) => [option.value, option]));

const pad = (value: number): string => String(value).padStart(2, "0");

const toDateInputValue = (date: Date): string => {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const startOfDay = (date: Date): Date => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const startOfWeek = (date: Date): Date => {
  const next = startOfDay(date);
  const offset = (next.getDay() + 6) % 7;
  return addDays(next, -offset);
};

type SchedulerTextKey = DashboardTextMessageKey<typeof schedulerMessages>;

const schedulerText = (
  locale: DashboardLocale,
  key: SchedulerTextKey,
  variables?: DashboardMessageVariables,
): string => translateDashboardMessage(schedulerMessages, locale, key, variables);

export const formatSchedulerDayLabel = (date: Date, locale: DashboardLocale): string => (
  createDashboardFormatters(locale).formatDate(date, { weekday: "short", month: "short", day: "numeric" })
);

export const formatSchedulerTimeLabel = (
  value: string | Date,
  locale: DashboardLocale,
  timeZone?: string,
): string => createDashboardFormatters(locale).formatTime(
  typeof value === "string" ? new Date(value) : value,
  { hour: "2-digit", minute: "2-digit", ...(timeZone ? { timeZone } : {}) },
);

const formatSchedulerDateTime = (
  value: string | Date,
  locale: DashboardLocale,
  timeZone?: string,
): string => createDashboardFormatters(locale).formatDate(
  typeof value === "string" ? new Date(value) : value,
  {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  },
);

const targetLabel = (targetType: ScheduleTargetType, locale: DashboardLocale): string => {
  const key = {
    sprint: "targetSprint",
    quicksprint: "targetQuicksprint",
    chat: "targetChat",
    memory_remediation: "targetMemory",
    node_flow: "targetNodeFlow",
    agent_wakeup: "targetAgentWakeup",
    task: "targetTask",
  } as const;
  return schedulerText(locale, key[targetType] ?? "targetFallback");
};

function isOperatorTargetType(targetType: ScheduleTargetType): targetType is OperatorScheduleTargetType {
  return OPERATOR_TARGET_TYPES.includes(targetType as OperatorScheduleTargetType);
}

const isOperatorEditableTarget = (targetType: ScheduleTargetType): targetType is OperatorScheduleTargetType => (
  isOperatorTargetType(targetType)
);

const unsupportedEditReason = (targetType: ScheduleTargetType, locale: DashboardLocale): string => (
  schedulerText(locale, "unsupportedEdit", { target: targetLabel(targetType, locale) })
);

const scheduleStatusLabel = (
  status: SchedulerEntryRecord["status"] | SchedulerOccurrence["status"] | undefined,
  locale: DashboardLocale,
): string => {
  const key = {
    scheduled: "statusScheduled",
    paused: "statusPaused",
    completed: "statusCompleted",
    failed: "statusFailed",
    cancelled: "statusCancelled",
  } as const;
  return schedulerText(locale, key[status ?? "scheduled"]);
};

const schedulerViewLabel = (view: SchedulerView, locale: DashboardLocale): string => (
  schedulerText(locale, view === "calendar" ? "calendar" : "dayView")
);

const recurrenceFrequencyLabel = (
  frequency: ScheduleRecurrenceRule["frequency"],
  interval: number,
  locale: DashboardLocale,
): string => {
  if (frequency === "minutely") {
    return schedulerText(locale, interval === 1 ? "frequencyMinute" : "frequencyMinutes", { count: interval });
  }
  if (interval === 1) {
    const key = {
      hourly: "frequencyHourly",
      daily: "frequencyDaily",
      weekly: "frequencyWeekly",
      monthly: "frequencyMonthly",
      none: "recurrenceOneTime",
    } as const;
    return schedulerText(locale, key[frequency]);
  }
  const key = {
    hourly: "frequencyHours",
    daily: "frequencyDays",
    weekly: "frequencyWeeks",
    monthly: "frequencyMonths",
    none: "recurrenceOneTime",
  } as const;
  return schedulerText(locale, key[frequency], { count: interval });
};

export const summarizeSchedulerRecurrence = (
  recurrence: ScheduleRecurrenceRule,
  locale: DashboardLocale,
  timeZone?: string,
): string => {
  if (recurrence.frequency === "none") {
    return schedulerText(locale, "recurrenceOneTime");
  }
  const every = recurrenceFrequencyLabel(recurrence.frequency, recurrence.interval, locale);
  if (recurrence.endMode === "after_count" && recurrence.count) {
    return schedulerText(locale, "recurrenceEveryRuns", { frequency: every, count: recurrence.count });
  }
  if (recurrence.endMode === "on_date" && recurrence.until) {
    return schedulerText(locale, "recurrenceEveryUntil", {
      frequency: every,
      until: formatSchedulerDateTime(recurrence.until, locale, timeZone),
    });
  }
  return schedulerText(locale, "recurrenceEvery", { frequency: every });
};

const scheduleAnchorOffsetLabel = (offsetMinutes: number | undefined, locale: DashboardLocale): string => {
  const offset = Math.max(0, Math.floor(Number(offsetMinutes ?? 0)));
  if (offset === 0) {
    return "";
  }
  if (offset === 1) {
    return schedulerText(locale, "offsetOneMinute");
  }
  return schedulerText(locale, "offsetManyMinutes", { count: offset });
};

const sprintDisplayName = (sprints: SprintRecord[], sprintId: string): string => (
  sprints.find((sprint) => sprint.id === sprintId)?.name || sprintId
);

const nodeFlowDisplayName = (nodeFlows: NodeFlowRecord[], flowId: string): string => (
  nodeFlows.find((flow) => flow.id === flowId)?.title || flowId
);

const isNodeFlowJsonValue = (value: unknown): value is NodeFlowJsonValue => {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isNodeFlowJsonValue);
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(isNodeFlowJsonValue);
  }
  return false;
};

const isNodeFlowJsonObject = (value: unknown): value is NodeFlowJsonObject => (
  typeof value === "object"
  && value !== null
  && !Array.isArray(value)
  && Object.values(value as Record<string, unknown>).every(isNodeFlowJsonValue)
);

const parseNodeFlowInputJson = (rawInput: string, locale: DashboardLocale): { input?: NodeFlowJsonObject; error?: string } => {
  if (!rawInput.trim()) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(rawInput);
    if (!isNodeFlowJsonObject(parsed)) {
      return { error: schedulerText(locale, "validationNodeFlowObject") };
    }
    return { input: parsed };
  } catch {
    return { error: schedulerText(locale, "validationNodeFlowJson") };
  }
};

const scheduleTimingSummary = (entry: SchedulerEntryRecord, sprints: SprintRecord[], locale: DashboardLocale): string => {
  if (entry.scheduleAnchor?.mode === "after_sprint_end") {
    return schedulerText(locale, "anchorAfterSprint", {
      sprint: sprintDisplayName(sprints, entry.scheduleAnchor.sourceSprintId),
      offset: scheduleAnchorOffsetLabel(entry.scheduleAnchor.offsetMinutes, locale),
    });
  }
  return schedulerText(locale, "nextRunAt", {
    date: entry.nextRunAt
      ? `${formatSchedulerDateTime(entry.nextRunAt, locale, entry.timezone)} (${entry.timezone})`
      : schedulerText(locale, "none"),
  });
};

const scheduleTargetSummary = (
  entry: SchedulerEntryRecord,
  sprints: SprintRecord[],
  templates: QuicksprintTemplateRecord[],
  nodeFlows: NodeFlowRecord[],
  locale: DashboardLocale,
): string => {
  if (entry.targetType === "sprint") {
    return entry.sprintTarget
      ? schedulerText(locale, "sprintSummary", { name: sprintDisplayName(sprints, entry.sprintTarget.sprintId) })
      : schedulerText(locale, "targetSprint");
  }
  if (entry.targetType === "quicksprint") {
    const templateId = entry.quicksprintTarget?.templateId;
    const templateName = templateId
      ? templates.find((template) => template.id === templateId)?.name || templateId
      : schedulerText(locale, "templateFallback");
    return schedulerText(locale, "quicksprintSummary", { name: templateName });
  }
  if (entry.targetType === "chat") {
    return entry.chatTarget?.threadId
      ? schedulerText(locale, "chatThreadSummary", { threadId: entry.chatTarget.threadId })
      : schedulerText(locale, "projectChatMessage");
  }
  if (entry.targetType === "memory_remediation") {
    return schedulerText(locale, "remediationSummary", {
      mode: schedulerText(locale, entry.memoryRemediationTarget?.mode === "ai" ? "aiReview" : "deterministicCleanup"),
    });
  }
  if (entry.targetType === "node_flow") {
    const flowId = entry.nodeFlowTarget?.flowId;
    return flowId
      ? schedulerText(locale, "nodeFlowSummary", { name: nodeFlowDisplayName(nodeFlows, flowId) })
      : schedulerText(locale, "targetNodeFlow");
  }
  if (entry.targetType === "agent_wakeup") {
    return entry.agentWakeupTarget?.threadId
      ? schedulerText(locale, "agentWakeupSummary", { threadId: entry.agentWakeupTarget.threadId })
      : schedulerText(locale, "agentWakeupMessage");
  }
  const provider = entry.taskTarget?.provider ? ` · ${entry.taskTarget.provider}` : "";
  return entry.taskTarget?.taskId
    ? schedulerText(locale, "taskRerunSummary", { taskId: entry.taskTarget.taskId, provider })
    : schedulerText(locale, "taskRerun");
};

const ProjectPlaceholder: FunctionComponent = () => (
  <div className="rounded-[1.75rem] border border-black/[0.06] bg-white/70 p-6 md:p-8 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-signal-500/20 bg-signal-500/[0.08] text-signal-500 shadow-[0_0_15px_rgba(0,224,160,0.08)]">
      <CalendarDays className="h-5 w-5" />
    </div>
    <LocalizedProjectPlaceholderCopy />
  </div>
);

const LocalizedProjectPlaceholderCopy: FunctionComponent = () => {
  const { translate } = useDashboardI18n();
  return (
    <>
    <h1 className="mt-5 font-display text-2xl md:text-3xl font-black tracking-tight text-slate-900 dark:text-white">{translate(schedulerMessages, "selectProjectTitle")}</h1>
    <p className="mt-3 max-w-xl text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400">
      {translate(schedulerMessages, "selectProjectDescription")}
    </p>
    </>
  );
};

export const SchedulerPage: FunctionComponent = () => {
  const { selectedProject } = useProjectData();
  const { locale, translate, translatePlural, formatNumber, formatTime } = useDashboardI18n();
  const refreshSequence = useRef(0);
  const submitInFlight = useRef(false);
  const [view, setView] = useState<SchedulerView>("calendar");
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [schedule, setSchedule] = useState<SchedulerCollectionResponse | null>(null);
  const [sprints, setSprints] = useState<SprintRecord[]>([]);
  const [templates, setTemplates] = useState<QuicksprintTemplateRecord[]>([]);
  const [nodeFlows, setNodeFlows] = useState<NodeFlowRecord[]>([]);

  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(() => {
    const today = new Date().getDay();
    return (today + 6) % 7; // 0=Monday, 6=Sunday
  });
  const [isMobileView, setIsMobileView] = useState<boolean>(false);
  const [isTabletView, setIsTabletView] = useState<boolean>(false);

  useEffect(() => {
    const mobileQuery = window.matchMedia('(max-width: 767px)');
    const tabletQuery = window.matchMedia('(max-width: 1023px)');

    const updateViews = () => {
      setIsMobileView(mobileQuery.matches);
      setIsTabletView(tabletQuery.matches);
    };

    updateViews();
    mobileQuery.addEventListener('change', updateViews);
    tabletQuery.addEventListener('change', updateViews);

    return () => {
      mobileQuery.removeEventListener('change', updateViews);
      tabletQuery.removeEventListener('change', updateViews);
    };
  }, []);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>({ tone: "idle", message: null });

  const [editingEntry, setEditingEntry] = useState<SchedulerEntryRecord | null>(null);
  const [entryTitle, setEntryTitle] = useState("");
  const [targetType, setTargetType] = useState<ScheduleTargetType>("sprint");
  const [scheduledFor, setScheduledFor] = useState(() => {
    const date = new Date();
    date.setHours(date.getHours() + 1, 0, 0, 0);
    return toDateInputValue(date);
  });
  const [scheduleTimingMode, setScheduleTimingMode] = useState<ScheduleTimingMode>("absolute");
  const [anchorSourceSprintId, setAnchorSourceSprintId] = useState("");
  const [anchorOffsetMinutes, setAnchorOffsetMinutes] = useState(0);
  const [selectedSprintId, setSelectedSprintId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [taskCount, setTaskCount] = useState(5);
  const [chatMessage, setChatMessage] = useState("");
  const [memoryRemediationMode, setMemoryRemediationMode] = useState<"deterministic" | "ai">("deterministic");
  const [selectedNodeFlowId, setSelectedNodeFlowId] = useState("");
  const [nodeFlowInputJson, setNodeFlowInputJson] = useState("");
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [frequency, setFrequency] = useState<ScheduleRecurrenceRule["frequency"]>("daily");
  const [interval, setIntervalValue] = useState(1);
  const [endMode, setEndMode] = useState<ScheduleRecurrenceRule["endMode"]>("never");
  const [count, setCount] = useState(6);
  const [until, setUntil] = useState(() => toDateInputValue(addDays(new Date(), 30)));
  const selectedTimezone = editingEntry?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const range = useMemo(() => {
    const from = startOfWeek(selectedDate);
    const to = addDays(from, 6);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }, [selectedDate]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!selectedProject) {
      return;
    }
    const requestId = ++refreshSequence.current;
    setLoading(true);
    try {
      const [nextSchedule, sprintResponse, quicksprintTemplates, nodeFlowResponse] = await Promise.all([
        fetchProjectSchedule(selectedProject.id, range.from.toISOString(), range.to.toISOString(), signal),
        fetchSprints(selectedProject.id, signal),
        fetchQuicksprintTemplates(selectedProject.id),
        fetchNodeFlows(selectedProject.id, signal),
      ]);
      if (signal?.aborted || requestId !== refreshSequence.current) {
        return;
      }
      setSchedule(nextSchedule);
      setSprints(sprintResponse.sprints);
      setTemplates(quicksprintTemplates);
      setNodeFlows(nodeFlowResponse.flows);
      setSelectedSprintId((current) => current || sprintResponse.sprints.find((sprint) => sprint.status !== "completed")?.id || "");
      setAnchorSourceSprintId((current) => current || sprintResponse.sprints[0]?.id || "");
      setSelectedTemplateId((current) => current || quicksprintTemplates[0]?.id || "");
      setSelectedNodeFlowId((current) => (
        nodeFlowResponse.flows.some((flow) => flow.id === current)
          ? current
          : nodeFlowResponse.flows[0]?.id || ""
      ));
    } catch (error) {
      if (!signal?.aborted && requestId === refreshSequence.current) {
        setFeedback({ tone: "error", message: error instanceof Error ? error.message : translate(schedulerMessages, "failedLoad") });
      }
    } finally {
      if (!signal?.aborted && requestId === refreshSequence.current) {
        setLoading(false);
      }
    }
  }, [range.from, range.to, selectedProject, translate]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const incompleteSprints = useMemo(() => sprints.filter((sprint) => sprint.status !== "completed"), [sprints]);
  const canUseAnchoredTiming = targetType === "sprint" || targetType === "quicksprint";
  const isAnchoredTiming = canUseAnchoredTiming && scheduleTimingMode === "after_sprint_end";

  useEffect(() => {
    if (!canUseAnchoredTiming && scheduleTimingMode === "after_sprint_end") {
      setScheduleTimingMode("absolute");
    }
  }, [canUseAnchoredTiming, scheduleTimingMode]);

  useEffect(() => {
    if (!selectedProject?.id) return;
    return subscribeToDashboardRealtime([`project:${selectedProject.id}`], (message) => {
      // The scheduler reflects sprint structure/state, which travels on the
      // lightweight `project.structure.updated` event delivered to this base
      // scope. (The heavy `project.live.updated` payload now rides a dedicated
      // `:live` sub-scope that this page intentionally does not subscribe to.)
      if (
        message.type === "snapshot_required"
        || (message.type === "event" && message.event.eventType === "project.structure.updated")
      ) {
        void refresh();
      }
    });
  }, [selectedProject?.id, refresh]);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_item, index) => addDays(startOfWeek(selectedDate), index)), [selectedDate]);
  const dayOccurrences = useMemo(() => {
    const dayStart = startOfDay(selectedDate).getTime();
    const dayEnd = addDays(startOfDay(selectedDate), 1).getTime();
    return (schedule?.occurrences || []).filter((occurrence) => {
      const time = new Date(occurrence.startsAt).getTime();
      return time >= dayStart && time < dayEnd;
    });
  }, [schedule?.occurrences, selectedDate]);

  const occurrencesByDay = useMemo(() => {
    const grouped = new Map<string, SchedulerOccurrence[]>();
    for (const occurrence of schedule?.occurrences || []) {
      const key = startOfDay(new Date(occurrence.startsAt)).toISOString();
      grouped.set(key, [...(grouped.get(key) || []), occurrence]);
    }
    return grouped;
  }, [schedule?.occurrences]);

  const schedulerStats = useMemo(() => {
    const entries = schedule?.entries || [];
    const activeEntries = entries.filter((entry) => entry.status === "scheduled");
    const repeatingEntries = entries.filter((entry) => entry.recurrence.frequency !== "none");
    const nextOccurrence = (schedule?.occurrences || [])
      .filter((occurrence) => new Date(occurrence.startsAt).getTime() >= Date.now())
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] || null;

    return {
      activeCount: activeEntries.length,
      repeatingCount: repeatingEntries.length,
      visibleCount: schedule?.occurrences.length || 0,
      nextOccurrence,
    };
  }, [schedule?.entries, schedule?.occurrences]);

  const scheduleRangeStatus = loading && !schedule
    ? translate(schedulerMessages, "loadingSchedule")
    : loading
      ? translate(schedulerMessages, "updatingSchedule", {
        count: formatNumber(schedulerStats.visibleCount),
        from: formatSchedulerDayLabel(range.from, locale),
        to: formatSchedulerDayLabel(range.to, locale),
      })
      : translate(schedulerMessages, "visibleScheduleRange", {
        count: formatNumber(schedulerStats.visibleCount),
        from: formatSchedulerDayLabel(range.from, locale),
        to: formatSchedulerDayLabel(range.to, locale),
      });

  const focusSchedulerView = (nextView: SchedulerView) => {
    setView(nextView);
    window.requestAnimationFrame(() => {
      document.getElementById(`scheduler-view-tab-${nextView}`)?.focus();
    });
  };

  const handleSchedulerViewKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    const views: SchedulerView[] = ["calendar", "day"];
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const currentIndex = views.indexOf(view);
    if (event.key === "Home") {
      focusSchedulerView(views[0]!);
      return;
    }
    if (event.key === "End") {
      focusSchedulerView(views[views.length - 1]!);
      return;
    }
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    focusSchedulerView(views[(currentIndex + delta + views.length) % views.length]!);
  };

  const startEdit = (entry: SchedulerEntryRecord) => {
    if (!isOperatorEditableTarget(entry.targetType)) {
      setFeedback({ tone: "error", message: unsupportedEditReason(entry.targetType, locale) });
      return;
    }
    setEditingEntry(entry);
    setEntryTitle(entry.title);
    setTargetType(entry.targetType);
    setScheduledFor(toDateInputValue(new Date(entry.scheduledFor)));
    if (entry.scheduleAnchor?.mode === "after_sprint_end") {
      setScheduleTimingMode("after_sprint_end");
      setAnchorSourceSprintId(entry.scheduleAnchor.sourceSprintId);
      setAnchorOffsetMinutes(entry.scheduleAnchor.offsetMinutes ?? 0);
    } else {
      setScheduleTimingMode("absolute");
      setAnchorSourceSprintId((current) => current || sprints[0]?.id || "");
      setAnchorOffsetMinutes(0);
    }

    if (entry.targetType === "sprint" && entry.sprintTarget) {
      setSelectedSprintId(entry.sprintTarget.sprintId);
    } else if (entry.targetType === "quicksprint" && entry.quicksprintTarget) {
      setSelectedTemplateId(entry.quicksprintTarget.templateId);
      setTaskCount(entry.quicksprintTarget.taskCount);
    } else if (entry.targetType === "chat" && entry.chatTarget) {
      setChatMessage(entry.chatTarget.bodyMarkdown);
    } else if (entry.targetType === "memory_remediation" && entry.memoryRemediationTarget) {
      setMemoryRemediationMode(entry.memoryRemediationTarget.mode);
    } else if (entry.targetType === "node_flow" && entry.nodeFlowTarget) {
      setSelectedNodeFlowId(entry.nodeFlowTarget.flowId);
      setNodeFlowInputJson(entry.nodeFlowTarget.input ? JSON.stringify(entry.nodeFlowTarget.input, null, 2) : "");
    }

    if (entry.recurrence && entry.recurrence.frequency !== "none") {
      setRepeatEnabled(true);
      setFrequency(entry.recurrence.frequency);
      setIntervalValue(entry.recurrence.interval || 1);
      setEndMode(entry.recurrence.endMode || "never");
      setCount(entry.recurrence.count || 6);
      setUntil(entry.recurrence.until ? toDateInputValue(new Date(entry.recurrence.until)) : toDateInputValue(addDays(new Date(), 30)));
    } else {
      setRepeatEnabled(false);
    }
    if (entry.scheduleAnchor) {
      setRepeatEnabled(false);
    }
  };

  const cancelEdit = (clearFeedback = true) => {
    setEditingEntry(null);
    setEntryTitle("");
    setTargetType("sprint");
    const date = new Date();
    date.setHours(date.getHours() + 1, 0, 0, 0);
    setScheduledFor(toDateInputValue(date));
    setScheduleTimingMode("absolute");
    setAnchorSourceSprintId(sprints[0]?.id || "");
    setAnchorOffsetMinutes(0);
    setSelectedSprintId(sprints.find((sprint) => sprint.status !== "completed")?.id || "");
    setSelectedTemplateId(templates[0]?.id || "");
    setTaskCount(5);
    setChatMessage("");
    setMemoryRemediationMode("deterministic");
    setSelectedNodeFlowId(nodeFlows[0]?.id || "");
    setNodeFlowInputJson("");
    setRepeatEnabled(false);
    setFrequency("daily");
    setIntervalValue(1);
    setEndMode("never");
    setCount(6);
    setUntil(toDateInputValue(addDays(new Date(), 30)));
    if (clearFeedback) {
      setFeedback({ tone: "idle", message: null });
    }
  };

  const editOccurrence = (occurrence: SchedulerOccurrence) => {
    const entry = (schedule?.entries || []).find((e) => e.id === occurrence.entryId);
    if (entry) {
      startEdit(entry);
    } else {
      setFeedback({ tone: "error", message: translate(schedulerMessages, "parentEntryNotFound") });
    }
  };

  const submitSchedule = async () => {
    if (!selectedProject || submitInFlight.current) {
      return;
    }
    setFeedback({ tone: "idle", message: null });
    if (!isOperatorEditableTarget(targetType)) {
      setFeedback({ tone: "error", message: unsupportedEditReason(targetType, locale) });
      return;
    }

    const scheduledDate = isAnchoredTiming ? null : new Date(scheduledFor);
    if (scheduledDate && !Number.isFinite(scheduledDate.getTime())) {
      setFeedback({ tone: "error", message: translate(schedulerMessages, "validationDateTime") });
      return;
    }

    let recurrenceUntil: Date | null = null;
    if (repeatEnabled && !isAnchoredTiming) {
      if (!Number.isInteger(interval) || interval < 1) {
        setFeedback({ tone: "error", message: translate(schedulerMessages, "validationInterval") });
        return;
      }
      if (endMode === "after_count" && (!Number.isInteger(count) || count < 1)) {
        setFeedback({ tone: "error", message: translate(schedulerMessages, "validationCount") });
        return;
      }
      if (endMode === "on_date") {
        recurrenceUntil = new Date(until);
        if (!Number.isFinite(recurrenceUntil.getTime())) {
          setFeedback({ tone: "error", message: translate(schedulerMessages, "validationEndDate") });
          return;
        }
        if (scheduledDate && recurrenceUntil.getTime() <= scheduledDate.getTime()) {
          setFeedback({ tone: "error", message: translate(schedulerMessages, "validationEndAfterStart") });
          return;
        }
      }
    }

    const recurrence: Partial<ScheduleRecurrenceRule> = repeatEnabled && !isAnchoredTiming
      ? {
        frequency,
        interval,
        endMode,
        count: endMode === "after_count" ? count : null,
        until: recurrenceUntil?.toISOString() ?? null,
      }
      : { frequency: "none", interval: 1, endMode: "never" };

    const titleVal = entryTitle.trim();
    const generatedTitle = (() => {
      if (targetType === "sprint") {
        const sprint = sprints.find((item) => item.id === selectedSprintId);
        return sprint ? `Run ${sprint.name}` : "Scheduled sprint";
      } else if (targetType === "quicksprint") {
        const template = templates.find((item) => item.id === selectedTemplateId);
        return template ? `Run ${template.name}` : "Scheduled quicksprint";
      } else if (targetType === "memory_remediation") {
        return "Long-term memory remediation";
      } else if (targetType === "node_flow") {
        const nodeFlow = nodeFlows.find((item) => item.id === selectedNodeFlowId);
        return nodeFlow ? `Run ${nodeFlow.title}` : "Scheduled node flow";
      } else {
        return "Scheduled chat message";
      }
    })();

    const finalTitle = titleVal || generatedTitle;

    if (targetType === "sprint") {
      if (!selectedSprintId) {
        setFeedback({ tone: "error", message: translate(schedulerMessages, "validationChooseSprint") });
        return;
      }
      const sprint = sprints.find((item) => item.id === selectedSprintId);
      if (!sprint || (sprint.status === "completed" && (!editingEntry || editingEntry.sprintTarget?.sprintId !== selectedSprintId))) {
        setFeedback({ tone: "error", message: translate(schedulerMessages, "validationChooseSprint") });
        return;
      }
    } else if (targetType === "quicksprint") {
      if (!selectedTemplateId) {
        setFeedback({ tone: "error", message: translate(schedulerMessages, "validationChooseTemplate") });
        return;
      }
      if (!Number.isInteger(taskCount) || taskCount < 1 || taskCount > 50) {
        setFeedback({ tone: "error", message: translate(schedulerMessages, "validationTaskCount") });
        return;
      }
    } else if (targetType === "chat") {
      if (!chatMessage.trim()) {
        setFeedback({ tone: "error", message: translate(schedulerMessages, "validationChatMessage") });
        return;
      }
    } else if (targetType === "node_flow") {
      if (!selectedNodeFlowId) {
        setFeedback({ tone: "error", message: translate(schedulerMessages, "validationChooseNodeFlow") });
        return;
      }
    }

    const parsedNodeFlowInput = targetType === "node_flow" ? parseNodeFlowInputJson(nodeFlowInputJson, locale) : {};
    if (parsedNodeFlowInput.error) {
      setFeedback({ tone: "error", message: parsedNodeFlowInput.error });
      return;
    }

    let scheduleAnchor: ScheduleAnchor | undefined;
    if (isAnchoredTiming) {
      if (!anchorSourceSprintId) {
        setFeedback({ tone: "error", message: translate(schedulerMessages, "validationChooseAnchorSprint") });
        return;
      }
      const offsetMinutes = Math.floor(Number(anchorOffsetMinutes || 0));
      if (!Number.isFinite(offsetMinutes) || offsetMinutes < 0) {
        setFeedback({ tone: "error", message: translate(schedulerMessages, "validationOffset") });
        return;
      }
      if (targetType === "sprint" && selectedSprintId === anchorSourceSprintId) {
        setFeedback({ tone: "error", message: translate(schedulerMessages, "validationOwnSprint") });
        return;
      }
      scheduleAnchor = {
        mode: "after_sprint_end",
        sourceSprintId: anchorSourceSprintId,
        offsetMinutes,
      };
    }

    const input: SchedulerFormInput = {
      title: finalTitle,
      targetType,
      timezone: selectedTimezone,
      recurrence,
    };
    if (scheduleAnchor) {
      input.scheduleAnchor = scheduleAnchor;
    } else {
      input.scheduledFor = scheduledDate!.toISOString();
      if (editingEntry?.scheduleAnchor) {
        input.scheduleAnchor = null;
      }
    }

    if (targetType === "sprint") {
      input.sprintTarget = { sprintId: selectedSprintId };
    } else if (targetType === "quicksprint") {
      input.quicksprintTarget = {
        templateId: selectedTemplateId,
        taskCount,
        submitMode: "plan_and_start",
      };
    } else if (targetType === "memory_remediation") {
      input.memoryRemediationTarget = {
        mode: memoryRemediationMode,
      };
    } else if (targetType === "node_flow") {
      input.nodeFlowTarget = {
        flowId: selectedNodeFlowId,
        ...(parsedNodeFlowInput.input ? { input: parsedNodeFlowInput.input } : {}),
      };
    } else {
      input.chatTarget = {
        bodyMarkdown: chatMessage.trim(),
        title: "Scheduled message",
      };
    }

    submitInFlight.current = true;
    setSubmitting(true);
    try {
      if (editingEntry) {
        await updateSchedulerEntry(editingEntry.id, input);
        cancelEdit(false);
        setFeedback({ tone: "success", message: translate(schedulerMessages, "scheduleUpdated") });
      } else {
        const createInput: CreateSchedulerEntryInput = {
          ...input,
          scheduleAnchor: input.scheduleAnchor ?? undefined,
        };
        await createSchedulerEntry(selectedProject.id, createInput);
        setFeedback({ tone: "success", message: translate(schedulerMessages, "scheduleCreated") });
        setChatMessage("");
        setEntryTitle("");
      }
      await refresh();
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : translate(schedulerMessages, "failedSave") });
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  };

  const toggleEntryStatus = async (entryId: string, paused: boolean) => {
    try {
      await updateSchedulerEntry(entryId, { status: paused ? "scheduled" : "paused" });
      await refresh();
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : translate(schedulerMessages, "failedUpdate") });
    }
  };

  const removeEntry = async (entryId: string) => {
    if (!window.confirm(translate(schedulerMessages, "deleteConfirmation"))) {
      return;
    }
    try {
      await deleteSchedulerEntry(entryId);
      await refresh();
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : translate(schedulerMessages, "failedDelete") });
    }
  };

  if (!selectedProject) {
    return (
      <PageContainer aria-label={translate(schedulerMessages, "pageLabel")} padding="standard" className="gap-8">
        <ProjectPlaceholder />
      </PageContainer>
    );
  }

  return (
    <PageContainer aria-label={translate(schedulerMessages, "pageLabel")} padding="standard" className="gap-8" data-testid="scheduler-page-root">
      <PageHeader
        data-testid="scheduler-primary-header"
        icon={CalendarDays}
        eyebrow={translate(schedulerMessages, "eyebrow")}
        title={translate(schedulerMessages, "title")}
        subtitle={translate(schedulerMessages, "subtitle")}
        actions={
        <div className="flex max-w-full flex-wrap items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            size="md"
            onClick={() => setSelectedDate(addDays(selectedDate, -7))}
          >
            {translate(schedulerMessages, "previous")}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => setSelectedDate(startOfDay(new Date()))}
          >
            {translate(schedulerMessages, "today")}
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={() => setSelectedDate(addDays(selectedDate, 7))}
          >
            {translate(schedulerMessages, "next")}
          </Button>
          <div
            className="ml-0 flex rounded-full border border-[color:var(--color-border-muted)] bg-white/72 p-1 dark:border-white/[0.06] dark:bg-white/[0.03] backdrop-blur-md lg:ml-2"
            role="tablist"
            aria-label={translate(schedulerMessages, "schedulerViews")}
            onKeyDown={handleSchedulerViewKeyDown}
          >
            {(["calendar", "day"] as SchedulerView[]).map((item) => (
              <button
                key={item}
                id={`scheduler-view-tab-${item}`}
                type="button"
                role="tab"
                aria-selected={view === item}
                aria-controls="scheduler-view-panel"
                tabIndex={view === item ? 0 : -1}
                onClick={() => setView(item)}
                className={`min-h-[34px] rounded-full px-4 text-[10px] font-bold uppercase tracking-[0.14em] transition-all duration-150 ${
                  view === item ? "bg-signal-500 text-white dark:text-void-900 shadow-[0_2px_8px_rgba(0,224,160,0.2)]" : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                {schedulerViewLabel(item, locale)}
              </button>
            ))}
          </div>
        </div>
        }
      />

      <section className="grid gap-3 md:grid-cols-3">
        {[
          { id: "active", label: translate(schedulerMessages, "activeEntries"), value: formatNumber(schedulerStats.activeCount), detail: translate(schedulerMessages, "readyToFire"), icon: Play, tone: "text-signal-500" },
          { id: "repeating", label: translate(schedulerMessages, "repeating"), value: formatNumber(schedulerStats.repeatingCount), detail: translate(schedulerMessages, "recurrenceRules"), icon: Repeat, tone: "text-signal-500" },
          {
            id: "next-run",
            label: translate(schedulerMessages, "nextRun"),
            value: schedulerStats.nextOccurrence ? formatSchedulerTimeLabel(schedulerStats.nextOccurrence.startsAt, locale) : translate(schedulerMessages, "none"),
            detail: schedulerStats.nextOccurrence ? schedulerStats.nextOccurrence.title : translate(schedulerMessages, "noUpcomingWork"),
            icon: Clock3,
            tone: "text-ember-500",
          },
        ].map((item) => (
          <div key={item.label} data-testid={`scheduler-stat-${item.id}`} className="relative overflow-hidden rounded-2xl border border-black/[0.06] bg-white/70 p-4 shadow-[0_2px_12px_rgba(0,0,0,0.02)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_16px_rgba(0,0,0,0.1)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent dark:via-white/10" />
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">{item.label}</div>
                <div className="mt-1 truncate font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-white">{item.value}</div>
                <div className="mt-0.5 truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">{item.detail}</div>
              </div>
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/[0.03] dark:bg-white/[0.03] ${item.tone}`}>
                <item.icon className="h-4.5 w-4.5" strokeWidth={2} />
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
        <aside data-testid="scheduler-form-panel" className="rounded-[1.75rem] border border-black/[0.06] bg-white/70 p-5 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                {translate(schedulerMessages, editingEntry ? "editEntry" : "addEntry")}
              </h3>
              <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                {translate(schedulerMessages, editingEntry ? "editEntryDescription" : "addEntryDescription")}
              </p>
            </div>
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${editingEntry ? "bg-signal-500/12 text-signal-500" : "bg-ember-500/12 text-ember-500"}`}>
              {editingEntry ? <Pencil className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2" role="group" aria-label={translate(schedulerMessages, "scheduleTargetType")}>
            <span className="sr-only" aria-live="polite" aria-atomic="true">
              {translate(schedulerMessages, "selectedScheduleTarget", { target: targetLabel(targetType, locale) })}
            </span>
            {FORM_TARGET_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setTargetType(option.value)}
                aria-pressed={targetType === option.value}
                className={`min-h-[70px] rounded-2xl border p-3 text-left transition-all duration-150 ${
                  targetType === option.value
                    ? option.activeClassName
                    : "border-black/[0.06] bg-black/[0.025] hover:bg-black/[0.04] dark:border-white/[0.06] dark:bg-white/[0.035] dark:hover:bg-white/[0.06]"
                }`}
              >
                <option.icon className={`mb-2 h-4 w-4 ${option.tone}`} />
                <span className="block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-600 dark:text-slate-300">{targetLabel(option.value, locale)}</span>
              </button>
            ))}
          </div>

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{translate(schedulerMessages, "titleField")}</span>
              <input
                type="text"
                value={entryTitle}
                onInput={(event) => setEntryTitle(event.currentTarget.value)}
                className={`mt-2 min-h-[44px] w-full ${SCHEDULER_FIELD_CLASS}`}
                placeholder={translate(schedulerMessages, "optionalTitle")}
              />
            </label>

            {targetType === "sprint" && (
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{translate(schedulerMessages, "targetSprint")}</span>
                <AvantgardeSelect
                  value={selectedSprintId}
                  onChange={setSelectedSprintId}
                  searchable={true}
                  options={[
                    { value: "", label: translate(schedulerMessages, "chooseSprint") },
                    ...incompleteSprints.map((sprint) => ({ value: sprint.id, label: sprint.name })),
                    ...(editingEntry && editingEntry.sprintTarget && !incompleteSprints.some(s => s.id === editingEntry.sprintTarget?.sprintId)
                      ? [{ value: editingEntry.sprintTarget.sprintId, label: sprints.find(s => s.id === editingEntry.sprintTarget?.sprintId)?.name || editingEntry.sprintTarget.sprintId }]
                      : []
                    )
                  ]}
                  className="mt-2"
                />
              </label>
            )}

            {targetType === "quicksprint" && (
              <div className="grid gap-3">
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{translate(schedulerMessages, "targetQuicksprint")}</span>
                  <AvantgardeSelect
                    value={selectedTemplateId}
                    onChange={setSelectedTemplateId}
                    searchable={true}
                    options={[
                      { value: "", label: translate(schedulerMessages, "chooseTemplate") },
                      ...templates.map((template) => ({ value: template.id, label: template.name }))
                    ]}
                    className="mt-2"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{translate(schedulerMessages, "taskCount")}</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={taskCount}
                    onInput={(event) => setTaskCount(Number(event.currentTarget.value))}
                    className={`mt-2 min-h-[44px] w-full ${SCHEDULER_FIELD_CLASS}`}
                  />
                </label>
              </div>
            )}

            {targetType === "chat" && (
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{translate(schedulerMessages, "chatMessageLabel")}</span>
                <textarea
                  value={chatMessage}
                  onInput={(event) => setChatMessage(event.currentTarget.value)}
                  rows={5}
                  className={`mt-2 w-full resize-none py-3 font-medium ${SCHEDULER_FIELD_CLASS}`}
                  placeholder={translate(schedulerMessages, "chatMessagePlaceholder")}
                />
              </label>
            )}

            {targetType === "memory_remediation" && (
              <div className="block">
                <label htmlFor="scheduler-remediation-mode" className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  {translate(schedulerMessages, "remediationMode")}
                </label>
                <select
                  id="scheduler-remediation-mode"
                  value={memoryRemediationMode}
                  onInput={(event) => setMemoryRemediationMode(event.currentTarget.value === "ai" ? "ai" : "deterministic")}
                  className={`mt-2 min-h-[44px] w-full ${SCHEDULER_FIELD_CLASS}`}
                >
                  <option value="deterministic">{translate(schedulerMessages, "deterministicCleanup")}</option>
                  <option value="ai">{translate(schedulerMessages, "aiRoutedReview")}</option>
                </select>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  {translate(schedulerMessages, "remediationRecommendation")}
                </p>
              </div>
            )}

            {targetType === "node_flow" && (
              <div className="grid gap-3">
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{translate(schedulerMessages, "targetNodeFlow")}</span>
                  <AvantgardeSelect
                    value={selectedNodeFlowId}
                    onChange={setSelectedNodeFlowId}
                    searchable={true}
                    options={[
                      { value: "", label: translate(schedulerMessages, nodeFlows.length > 0 ? "chooseNodeFlow" : "noSavedNodeFlows") },
                      ...nodeFlows.map((flow) => ({ value: flow.id, label: flow.title })),
                    ]}
                    className="mt-2"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{translate(schedulerMessages, "jsonInput")}</span>
                  <textarea
                    value={nodeFlowInputJson}
                    onInput={(event) => setNodeFlowInputJson(event.currentTarget.value)}
                    rows={5}
                    spellcheck={false}
                    className={`mt-2 w-full resize-y py-3 font-mono text-xs ${SCHEDULER_FIELD_CLASS}`}
                    placeholder={translate(schedulerMessages, "jsonInputPlaceholder")}
                  />
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">
                    {translate(schedulerMessages, "jsonInputHelp")}
                  </p>
                </label>
              </div>
            )}

            <div className="rounded-2xl border border-black/[0.06] bg-black/[0.015] p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{translate(schedulerMessages, "timing")}</div>
              <div className="mt-3 grid gap-2" role="radiogroup" aria-label={translate(schedulerMessages, "scheduleTiming")}>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-black/[0.06] bg-white/60 px-3 py-2.5 text-xs font-bold text-slate-700 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-200">
                  <input
                    type="radio"
                    name="schedule-timing-mode"
                    value="absolute"
                    checked={scheduleTimingMode === "absolute"}
                    onChange={() => setScheduleTimingMode("absolute")}
                    className="h-4 w-4 accent-signal-500"
                  />
                  {translate(schedulerMessages, "absoluteDateTime")}
                </label>
                {canUseAnchoredTiming && (
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-black/[0.06] bg-white/60 px-3 py-2.5 text-xs font-bold text-slate-700 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-200">
                    <input
                      type="radio"
                      name="schedule-timing-mode"
                      value="after_sprint_end"
                      checked={scheduleTimingMode === "after_sprint_end"}
                      onChange={() => setScheduleTimingMode("after_sprint_end")}
                      className="h-4 w-4 accent-signal-500"
                    />
                    {translate(schedulerMessages, "afterSprintEnds")}
                  </label>
                )}
              </div>

              {isAnchoredTiming ? (
                <div className="mt-4 grid gap-3">
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{translate(schedulerMessages, "waitForSprint")}</span>
                    <AvantgardeSelect
                      value={anchorSourceSprintId}
                      onChange={setAnchorSourceSprintId}
                      searchable={true}
                      options={[
                        { value: "", label: translate(schedulerMessages, "chooseSourceSprint") },
                        ...sprints.map((sprint) => ({
                          value: sprint.id,
                          label: translate(schedulerMessages, "sprintWithStatus", {
                            name: sprint.name,
                            status: sprint.status,
                          }),
                        })),
                      ]}
                      className="mt-2"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{translate(schedulerMessages, "offsetMinutes")}</span>
                    <input
                      type="number"
                      min={0}
                      value={anchorOffsetMinutes}
                      onInput={(event) => setAnchorOffsetMinutes(Number(event.currentTarget.value))}
                      className={`mt-2 min-h-[44px] w-full ${SCHEDULER_FIELD_CLASS}`}
                    />
                  </label>
                  <p className="text-xs leading-relaxed text-slate-400">
                    {translate(schedulerMessages, "anchoredHelp")}
                  </p>
                </div>
              ) : (
                <div className="mt-4 block">
                  <label htmlFor="scheduler-scheduled-for" className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    {translate(schedulerMessages, "dateAndTime")}
                  </label>
                  <input
                    id="scheduler-scheduled-for"
                    type="datetime-local"
                    value={scheduledFor}
                    onInput={(event) => setScheduledFor(event.currentTarget.value)}
                    className={`mt-2 min-h-[44px] w-full ${SCHEDULER_FIELD_CLASS}`}
                  />
                  <p className="mt-2 text-xs font-medium text-slate-400">
                    {translate(schedulerMessages, "timezone", { timezone: selectedTimezone })}
                  </p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {[
                      { label: translate(schedulerMessages, "inOneHour"), date: () => { const date = new Date(); date.setHours(date.getHours() + 1, 0, 0, 0); return date; } },
                      { label: translate(schedulerMessages, "tomorrowAtNine"), date: () => { const date = addDays(new Date(), 1); date.setHours(9, 0, 0, 0); return date; } },
                      { label: translate(schedulerMessages, "mondayAtNine"), date: () => { const date = startOfWeek(addDays(new Date(), 7)); date.setHours(9, 0, 0, 0); return date; } },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setScheduledFor(toDateInputValue(preset.date()))}
                        className="min-h-[32px] rounded-full border border-black/[0.06] bg-black/[0.025] px-2 text-[10px] font-black uppercase tracking-[0.11em] text-slate-500 transition hover:border-signal-500/20 hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.035] dark:text-slate-400 dark:hover:text-white"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-black/[0.06] bg-black/[0.015] p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
              <label className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                  <Repeat className="h-4 w-4 text-signal-500" />
                  {translate(schedulerMessages, "repeat")}
                </span>
                <input
                  type="checkbox"
                  checked={repeatEnabled}
                  disabled={isAnchoredTiming}
                  onChange={(event) => setRepeatEnabled(event.currentTarget.checked)}
                  className="h-5 w-5 accent-signal-500 rounded border-black/[0.08] dark:border-white/[0.08]"
                />
              </label>

              {isAnchoredTiming && (
                <p className="mt-3 text-xs leading-relaxed text-slate-400">
                  {translate(schedulerMessages, "anchoredOneTime")}
                </p>
              )}

              {repeatEnabled && !isAnchoredTiming && (
                <div className="mt-4 grid gap-3">
                  <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
                    <input
                      type="number"
                      min={1}
                      value={interval}
                      onInput={(event) => setIntervalValue(Number(event.currentTarget.value))}
                      className={SCHEDULER_COMPACT_FIELD_CLASS}
                    />
                    <AvantgardeSelect
                      value={frequency}
                      onChange={(value) => setFrequency(value as ScheduleRecurrenceRule["frequency"])}
                      options={[
                        { value: "minutely", label: translate(schedulerMessages, "minutes") },
                        { value: "hourly", label: translate(schedulerMessages, "hours") },
                        { value: "daily", label: translate(schedulerMessages, "days") },
                        { value: "weekly", label: translate(schedulerMessages, "weeks") },
                        { value: "monthly", label: translate(schedulerMessages, "months") },
                      ]}
                    />
                  </div>

                  <AvantgardeSelect
                    value={endMode}
                    onChange={(value) => setEndMode(value as ScheduleRecurrenceRule["endMode"])}
                    options={[
                      { value: "never", label: translate(schedulerMessages, "endless") },
                      { value: "after_count", label: translate(schedulerMessages, "specificIterations") },
                      { value: "on_date", label: translate(schedulerMessages, "endDateTime") },
                    ]}
                  />

                  {endMode === "after_count" && (
                    <input
                      type="number"
                      min={1}
                      value={count}
                      onInput={(event) => setCount(Number(event.currentTarget.value))}
                      className={SCHEDULER_COMPACT_FIELD_CLASS}
                    />
                  )}

                  {endMode === "on_date" && (
                    <input
                      type="datetime-local"
                      value={until}
                      onInput={(event) => setUntil(event.currentTarget.value)}
                      className={SCHEDULER_COMPACT_FIELD_CLASS}
                    />
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              {editingEntry && (
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => cancelEdit()}
                  className="flex-1 text-[10px] uppercase tracking-[0.16em]"
                >
                  {translate(schedulerMessages, "cancel")}
                </Button>
              )}
              <Button
                variant="signal"
                size="lg"
                onClick={() => void submitSchedule()}
                disabled={submitting}
                className={editingEntry ? "flex-1 text-[10px] uppercase tracking-[0.16em]" : "w-full text-[10px] uppercase tracking-[0.16em]"}
                icon={editingEntry ? Check : Send}
              >
                {translate(schedulerMessages, editingEntry ? "save" : "schedule")}
              </Button>
            </div>

            {feedback.message && (
              <div role={feedback.tone === "error" ? "alert" : "status"} aria-live={feedback.tone === "error" ? "assertive" : "polite"} aria-atomic="true" className={`rounded-[var(--radius-ui)] border px-4 py-3 text-xs font-semibold backdrop-blur-md transition-all duration-150 ${
                feedback.tone === "error"
                  ? "border-status-red/20 bg-status-red/[0.06] text-status-red"
                  : "border-signal-500/20 bg-signal-500/[0.06] text-signal-600 dark:text-signal-400"
              }`}>
                {feedback.message}
              </div>
            )}
          </div>
        </aside>

        <div className="min-w-0 space-y-6">
          <section
            id="scheduler-view-panel"
            role="tabpanel"
            aria-labelledby={`scheduler-view-tab-${view}`}
            aria-busy={loading ? "true" : undefined}
            data-testid="scheduler-calendar-panel"
            className="rounded-[1.75rem] border border-black/[0.06] bg-white/70 p-4 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)] md:p-5"
          >
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                  {translate(schedulerMessages, view === "calendar" ? "calendarView" : "dayViewTitle")}
                </h3>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400" role="status" aria-live="polite" aria-atomic="true">
                  {scheduleRangeStatus}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setFeedback({ tone: "idle", message: null });
                  void refresh();
                }}
                icon={RefreshCw}
                className="uppercase tracking-[0.14em]"
              >
                {translate(schedulerMessages, "refresh")}
              </Button>
            </div>

            {view === "calendar" ? (
              <>
                {(isMobileView || (isTabletView && !isMobileView)) && (
                  <div className="mb-4 flex items-center justify-between rounded-xl border border-black/[0.06] bg-black/[0.02] p-2 dark:border-white/[0.06] dark:bg-white/[0.02]">
                    <button
                      type="button"
                      onClick={() => setSelectedDayIndex((prev) => Math.max(0, prev - 1))}
                      disabled={selectedDayIndex === 0}
                      className="px-3 py-1.5 text-xs font-bold text-slate-600 rounded-[var(--radius-ui)] border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] hover:text-slate-900 hover:bg-[var(--surface-glass-hover)] disabled:opacity-50 disabled:cursor-not-allowed dark:text-slate-300 dark:hover:text-white"
                    >
                      {translate(schedulerMessages, "previous")}
                    </button>
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                      {formatSchedulerDayLabel(weekDays[selectedDayIndex], locale)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedDayIndex((prev) => Math.min(6, prev + 1))}
                      disabled={selectedDayIndex === 6}
                      className="px-3 py-1.5 text-xs font-bold text-slate-600 rounded-[var(--radius-ui)] border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] hover:text-slate-900 hover:bg-[var(--surface-glass-hover)] disabled:opacity-50 disabled:cursor-not-allowed dark:text-slate-300 dark:hover:text-white"
                    >
                      {translate(schedulerMessages, "next")}
                    </button>
                  </div>
                )}
                <div className={
                  isMobileView
                    ? "grid grid-cols-1 gap-3 pb-2"
                    : isTabletView
                      ? "grid grid-cols-3 gap-3 pb-2"
                      : "grid grid-flow-col auto-cols-[minmax(8.75rem,1fr)] gap-3 overflow-x-auto pb-2 dashboard-scrollbar"
                }>
                {weekDays.map((day, index) => {
                  if (isMobileView && index !== selectedDayIndex) return null;
                  if (isTabletView && !isMobileView) {
                    const startIdx = Math.max(0, Math.min(4, selectedDayIndex - 1));
                    if (index < startIdx || index > startIdx + 2) return null;
                  }

                  const key = startOfDay(day).toISOString();
                  const dayItems = occurrencesByDay.get(key) || [];
                  const selected = key === startOfDay(selectedDate).toISOString();
                  const isToday = key === startOfDay(new Date()).toISOString();
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedDate(day)}
                      aria-pressed={selected}
                      aria-label={translatePlural(schedulerMessages, "dayOccurrenceCount", dayItems.length, {
                        day: formatSchedulerDayLabel(day, locale),
                      })}
                      className={`min-h-[13rem] rounded-2xl border p-3.5 text-left transition-all duration-150 ${
                        selected
                          ? "border-signal-500/35 bg-signal-500/[0.08] shadow-[0_4px_16px_rgba(0,224,160,0.08)]"
                          : "border-black/[0.06] bg-black/[0.015] hover:-translate-y-0.5 hover:bg-black/[0.03] dark:border-white/[0.06] dark:bg-white/[0.02] dark:hover:bg-white/[0.04]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="whitespace-nowrap text-xs font-black uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">{formatSchedulerDayLabel(day, locale)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${isToday ? "bg-signal-500 text-white dark:text-void-900 shadow-[0_2px_8px_rgba(0,224,160,0.2)]" : "bg-white/80 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400"}`}>{formatNumber(dayItems.length)}</span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {dayItems.slice(0, 5).map((occurrence) => {
                          const option = targetOptionByType.get(occurrence.targetType);
                          const canEditOccurrence = isOperatorEditableTarget(occurrence.targetType);
                          const editReason = canEditOccurrence
                            ? translate(schedulerMessages, "editScheduleEntryFromOccurrence")
                            : unsupportedEditReason(occurrence.targetType, locale);
                          return (
                            <div key={occurrence.id} className="rounded-xl border border-black/[0.04] bg-white/80 p-2 text-xs shadow-sm dark:border-white/[0.05] dark:bg-white/[0.04]">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-bold text-slate-800 dark:text-white">{formatSchedulerTimeLabel(occurrence.startsAt, locale)}</span>
                                <div className="flex items-center gap-1">
                                  <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] ${option?.chipClassName || "bg-slate-500/10 text-slate-500"}`}>{targetLabel(occurrence.targetType, locale)}</span>
                                  <span className="rounded-full bg-black/[0.04] px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">{scheduleStatusLabel(occurrence.status, locale)}</span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (canEditOccurrence) {
                                        editOccurrence(occurrence);
                                      } else {
                                        setFeedback({ tone: "error", message: editReason });
                                      }
                                    }}
                                    aria-disabled={!canEditOccurrence}
                                    title={editReason}
                                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full border border-black/[0.06] bg-white/70 text-slate-600 transition-all duration-150 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 ${
                                      canEditOccurrence
                                        ? "hover:bg-white hover:text-slate-950 dark:hover:bg-white/[0.05] dark:hover:text-white"
                                        : "cursor-not-allowed opacity-45"
                                    }`}
                                    aria-label={editReason}
                                  >
                                    <Pencil className="h-2.5 w-2.5" />
                                  </button>
                                </div>
                              </div>
                              <div className="mt-1 line-clamp-2 font-semibold text-slate-500 dark:text-slate-400">{occurrence.title}</div>
                            </div>
                          );
                        })}
                        {dayItems.length > 5 && (
                          <div className="text-[10px] font-bold text-slate-400">{translate(schedulerMessages, "moreOccurrences", { count: formatNumber(dayItems.length - 5) })}</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
              </>
            ) : (
              <div className="max-h-[46rem] space-y-2 overflow-y-auto pr-1 dashboard-scrollbar">
                {Array.from({ length: 24 }, (_item, hour) => {
                  const hourItems = dayOccurrences.filter((occurrence) => new Date(occurrence.startsAt).getHours() === hour);
                  return (
                    <div key={hour} className="grid min-h-[64px] grid-cols-[4.5rem_minmax(0,1fr)] gap-3 rounded-xl border border-black/[0.04] bg-black/[0.01] p-2 dark:border-white/[0.04] dark:bg-white/[0.01]">
                      <div className="pt-2 text-right text-[11px] font-mono font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                        {formatTime(new Date(2000, 0, 1, hour), { hour: "numeric", minute: "2-digit" })}
                      </div>
                      <div className="space-y-2 border-l border-black/[0.05] pl-3 dark:border-white/[0.05]">
                        {hourItems.length === 0 && (
                          <div className="h-full min-h-[42px] rounded-xl border border-dashed border-black/[0.04] bg-white/[0.1] dark:border-white/[0.04] dark:bg-white/[0.01]" />
                        )}
                        {hourItems.map((occurrence) => {
                          const option = targetOptionByType.get(occurrence.targetType);
                          const canEditOccurrence = isOperatorEditableTarget(occurrence.targetType);
                          const editReason = canEditOccurrence
                            ? translate(schedulerMessages, "editScheduleEntryFromOccurrence")
                            : unsupportedEditReason(occurrence.targetType, locale);
                          return (
                            <div key={occurrence.id} className="rounded-xl border border-black/[0.04] bg-white/80 p-3 shadow-sm dark:border-white/[0.05] dark:bg-white/[0.04]">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="inline-flex items-center gap-2 text-xs font-black text-slate-900 dark:text-white">
                                  <Clock3 className={`h-3.5 w-3.5 ${option?.tone || "text-signal-500"}`} />
                                  {formatSchedulerTimeLabel(occurrence.startsAt, locale)}
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] ${option?.chipClassName || "bg-slate-500/10 text-slate-500"}`}>
                                    {targetLabel(occurrence.targetType, locale)}
                                  </span>
                                  <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
                                    {scheduleStatusLabel(occurrence.status, locale)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (canEditOccurrence) {
                                        editOccurrence(occurrence);
                                      } else {
                                        setFeedback({ tone: "error", message: editReason });
                                      }
                                    }}
                                    aria-disabled={!canEditOccurrence}
                                    title={editReason}
                                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full border border-black/[0.06] bg-white/70 text-slate-600 transition-all duration-150 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 ${
                                      canEditOccurrence
                                        ? "hover:bg-white hover:text-slate-950 dark:hover:bg-white/[0.05] dark:hover:text-white"
                                        : "cursor-not-allowed opacity-45"
                                    }`}
                                    aria-label={editReason}
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                </div>
                              </div>
                              <div className="mt-2 text-sm font-bold text-slate-700 dark:text-slate-200">{occurrence.title}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-[1.75rem] border border-black/[0.06] bg-white/70 p-4 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)] md:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-white">{translate(schedulerMessages, "scheduledEntries")}</h3>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{translate(schedulerMessages, "scheduledEntriesDescription")}</p>
              </div>
              <Check className="h-5 w-5 text-signal-500" />
            </div>

            <div className="space-y-3">
              {(schedule?.entries || []).length === 0 && (
                <div className="rounded-2xl border border-dashed border-black/[0.10] p-6 text-sm font-semibold text-slate-500 dark:border-white/[0.10] dark:text-slate-400">
                  {translate(schedulerMessages, "emptyEntries")}
                </div>
              )}

              {(schedule?.entries || []).map((entry) => {
                const option = targetOptionByType.get(entry.targetType);
                const canEditEntry = isOperatorEditableTarget(entry.targetType);
                const editReason = canEditEntry
                  ? translate(schedulerMessages, "editScheduleEntry")
                  : unsupportedEditReason(entry.targetType, locale);
                return (
                  <div key={entry.id} data-testid={`scheduler-entry-${entry.id}`} className="grid gap-3 rounded-2xl border border-black/[0.05] bg-white/60 p-4 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.04)] dark:border-white/[0.05] dark:bg-white/[0.03] md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] ${option?.chipClassName || "bg-slate-500/10 text-slate-500"}`}>
                          {targetLabel(entry.targetType, locale)}
                        </span>
                        <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
                          {scheduleStatusLabel(entry.status, locale)}
                        </span>
                        {entry.runCount > 0 && (
                          <span className="rounded-full border border-signal-500/20 bg-signal-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-signal-600 dark:text-signal-400">
                            {translate(schedulerMessages, "firedCount", { count: formatNumber(entry.runCount) })}
                          </span>
                        )}
                        <span className="text-[11px] font-bold text-slate-400">{summarizeSchedulerRecurrence(entry.recurrence, locale, entry.timezone)}</span>
                      </div>
                      <h4 className="mt-2 truncate text-sm font-semibold text-slate-900 dark:text-white">{entry.title}</h4>
                      <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                        {scheduleTargetSummary(entry, sprints, templates, nodeFlows, locale)} · {" "}
                        {scheduleTimingSummary(entry, sprints, locale)}
                        {entry.lastRunAt && ` · ${translate(schedulerMessages, "lastFiredAt", {
                          date: `${formatSchedulerDateTime(entry.lastRunAt, locale, entry.timezone)} (${entry.timezone})`,
                        })}`}
                      </p>
                      {entry.lastError && (
                        <p className="mt-2 text-xs font-bold text-status-red">{entry.lastError}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(entry)}
                        aria-disabled={!canEditEntry}
                        title={editReason}
                        className={`inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/[0.06] bg-white/70 text-slate-600 transition-all duration-150 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 ${
                          canEditEntry
                            ? "hover:bg-white hover:text-slate-950 dark:hover:bg-white/[0.05] dark:hover:text-white"
                            : "cursor-not-allowed opacity-45"
                        }`}
                        aria-label={editReason}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleEntryStatus(entry.id, entry.status === "paused")}
                        disabled={entry.status === "completed" || entry.status === "cancelled"}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/[0.06] bg-white/70 text-slate-600 transition-all duration-150 hover:bg-white hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.05] dark:hover:text-white"
                        aria-label={translate(schedulerMessages, entry.status === "paused" ? "resumeScheduleEntry" : "pauseScheduleEntry")}
                      >
                        {entry.status === "paused" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeEntry(entry.id)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-status-red/20 bg-status-red/[0.06] text-status-red transition-all duration-150 hover:bg-status-red/[0.12]"
                        aria-label={translate(schedulerMessages, "deleteScheduleEntry")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </section>
    </PageContainer>
  );
};
