import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import {
  CalendarDays,
  Check,
  Clock3,
  MessageCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Send,
  Trash2,
  Zap,
} from "lucide-preact";
import { PageContainer } from "./components/ui/PageContainer.js";
import { AvantgardeSelect } from "./components/ui/AvantgardeSelect.js";
import { useProjectData } from "./context/project-data.js";
import { subscribeToDashboardRealtime } from "../lib/realtime/dashboard-realtime-client.js";
import { fetchSprints } from "./lib/project-api.js";
import { fetchQuicksprintTemplates } from "./lib/quicksprint-api.js";
import {
  createSchedulerEntry,
  deleteSchedulerEntry,
  fetchProjectSchedule,
  updateSchedulerEntry,
} from "./lib/scheduler-api.js";
import type {
  CreateSchedulerEntryInput,
  SchedulerCollectionResponse,
  SchedulerOccurrence,
  ScheduleRecurrenceRule,
  ScheduleTargetType,
  SprintRecord,
} from "./types.js";
import type { QuicksprintTemplateRecord } from "../../../src/contracts/quicksprint-types.js";

type SchedulerView = "calendar" | "day";
type FeedbackState = { tone: "idle" | "success" | "error"; message: string | null };

const SCHEDULER_FIELD_CLASS = "scheduler-field rounded-xl border border-black/[0.08] bg-white/95 px-3 text-sm font-semibold text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] outline-none transition focus:border-signal-500 focus:bg-white focus:ring-4 focus:ring-signal-500/10 dark:border-white/[0.10] dark:bg-[#10151b] dark:text-white dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] dark:focus:border-signal-400 dark:focus:bg-[#121922]";
const SCHEDULER_COMPACT_FIELD_CLASS = `${SCHEDULER_FIELD_CLASS} min-h-[40px]`;

const TARGET_OPTIONS: Array<{
  value: ScheduleTargetType;
  label: string;
  icon: typeof Zap;
  tone: string;
  activeClassName: string;
  chipClassName: string;
}> = [
  {
    value: "sprint",
    label: "Sprint",
    icon: Zap,
    tone: "text-ember-500",
    activeClassName: "border-ember-500/35 bg-ember-500/10 shadow-[0_12px_34px_rgba(255,184,0,0.13)]",
    chipClassName: "bg-ember-500/12 text-ember-600 dark:text-ember-400",
  },
  {
    value: "quicksprint",
    label: "Quicksprint",
    icon: RefreshCw,
    tone: "text-sky-500",
    activeClassName: "border-sky-500/35 bg-sky-500/10 shadow-[0_12px_34px_rgba(14,165,233,0.13)]",
    chipClassName: "bg-sky-500/12 text-sky-600 dark:text-sky-300",
  },
  {
    value: "chat",
    label: "Chat message",
    icon: MessageCircle,
    tone: "text-signal-500",
    activeClassName: "border-signal-500/35 bg-signal-500/10 shadow-[0_12px_34px_rgba(0,224,160,0.13)]",
    chipClassName: "bg-signal-500/12 text-signal-600 dark:text-signal-400",
  },
];

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

const formatDayLabel = (date: Date): string => (
  date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
);

const formatTimeLabel = (iso: string): string => (
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
);

const targetLabel = (targetType: ScheduleTargetType): string => (
  targetType === "sprint" ? "Sprint" : targetType === "quicksprint" ? "Quicksprint" : "Chat"
);

const recurrenceSummary = (recurrence: ScheduleRecurrenceRule): string => {
  if (recurrence.frequency === "none") {
    return "One time";
  }
  const every = recurrence.interval === 1 ? recurrence.frequency : `${recurrence.interval} ${recurrence.frequency}`;
  if (recurrence.endMode === "after_count" && recurrence.count) {
    return `Every ${every}, ${recurrence.count} runs`;
  }
  if (recurrence.endMode === "on_date" && recurrence.until) {
    return `Every ${every} until ${new Date(recurrence.until).toLocaleString()}`;
  }
  return `Every ${every}`;
};

const ProjectPlaceholder: FunctionComponent = () => (
  <div className="rounded-[1.8rem] border border-black/[0.06] bg-white/72 p-8 shadow-[0_18px_48px_rgba(15,23,42,0.07)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/62">
    <div className="flex h-14 w-14 items-center justify-center rounded-[1.15rem] border border-signal-500/20 bg-signal-500/10 text-signal-500">
      <CalendarDays className="h-6 w-6" />
    </div>
    <h2 className="mt-5 font-display text-3xl font-black tracking-tight text-slate-900 dark:text-white">Select a project to schedule work.</h2>
    <p className="mt-3 max-w-xl text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400">
      Scheduler entries are project-scoped so sprints, quicksprints, and chat messages run against the right workspace.
    </p>
  </div>
);

export const SchedulerPage: FunctionComponent = () => {
  const { selectedProject } = useProjectData();
  const [view, setView] = useState<SchedulerView>("calendar");
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [schedule, setSchedule] = useState<SchedulerCollectionResponse | null>(null);
  const [sprints, setSprints] = useState<SprintRecord[]>([]);
  const [templates, setTemplates] = useState<QuicksprintTemplateRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>({ tone: "idle", message: null });

  const [targetType, setTargetType] = useState<ScheduleTargetType>("sprint");
  const [scheduledFor, setScheduledFor] = useState(() => {
    const date = new Date();
    date.setHours(date.getHours() + 1, 0, 0, 0);
    return toDateInputValue(date);
  });
  const [selectedSprintId, setSelectedSprintId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [taskCount, setTaskCount] = useState(5);
  const [chatMessage, setChatMessage] = useState("");
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [frequency, setFrequency] = useState<ScheduleRecurrenceRule["frequency"]>("daily");
  const [interval, setIntervalValue] = useState(1);
  const [endMode, setEndMode] = useState<ScheduleRecurrenceRule["endMode"]>("never");
  const [count, setCount] = useState(6);
  const [until, setUntil] = useState(() => toDateInputValue(addDays(new Date(), 30)));

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
    setLoading(true);
    try {
      const [nextSchedule, sprintResponse, quicksprintTemplates] = await Promise.all([
        fetchProjectSchedule(selectedProject.id, range.from.toISOString(), range.to.toISOString(), signal),
        fetchSprints(selectedProject.id, signal),
        fetchQuicksprintTemplates(selectedProject.id),
      ]);
      setSchedule(nextSchedule);
      setSprints(sprintResponse.sprints);
      setTemplates(quicksprintTemplates);
      setSelectedSprintId((current) => current || sprintResponse.sprints.find((sprint) => sprint.status !== "completed")?.id || "");
      setSelectedTemplateId((current) => current || quicksprintTemplates[0]?.id || "");
    } catch (error) {
      if (!signal?.aborted) {
        setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Failed to load scheduler." });
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [range.from, range.to, selectedProject]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (!selectedProject?.id) return;
    return subscribeToDashboardRealtime([`project:${selectedProject.id}`], (message) => {
      if (message.type === "event" && message.event.eventType === "project.live.updated") {
        void refresh();
      }
    });
  }, [selectedProject?.id, refresh]);

  const incompleteSprints = useMemo(() => sprints.filter((sprint) => sprint.status !== "completed"), [sprints]);
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

  const submitSchedule = async () => {
    if (!selectedProject) {
      return;
    }
    setFeedback({ tone: "idle", message: null });
    const recurrence: Partial<ScheduleRecurrenceRule> = repeatEnabled
      ? {
        frequency,
        interval,
        endMode,
        count: endMode === "after_count" ? count : null,
        until: endMode === "on_date" ? new Date(until).toISOString() : null,
      }
      : { frequency: "none", interval: 1, endMode: "never" };

    const input: CreateSchedulerEntryInput = {
      targetType,
      scheduledFor: new Date(scheduledFor).toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      recurrence,
    };

    if (targetType === "sprint") {
      if (!selectedSprintId) {
        setFeedback({ tone: "error", message: "Choose a sprint that is not completed." });
        return;
      }
      const sprint = incompleteSprints.find((item) => item.id === selectedSprintId);
      input.title = sprint ? `Run ${sprint.name}` : "Scheduled sprint";
      input.sprintTarget = { sprintId: selectedSprintId };
    } else if (targetType === "quicksprint") {
      if (!selectedTemplateId) {
        setFeedback({ tone: "error", message: "Choose a quicksprint template." });
        return;
      }
      const template = templates.find((item) => item.id === selectedTemplateId);
      input.title = template ? `Run ${template.name}` : "Scheduled quicksprint";
      input.quicksprintTarget = {
        templateId: selectedTemplateId,
        taskCount,
        submitMode: "plan_and_start",
      };
    } else {
      if (!chatMessage.trim()) {
        setFeedback({ tone: "error", message: "Write the chat message to schedule." });
        return;
      }
      input.title = "Scheduled chat message";
      input.chatTarget = {
        bodyMarkdown: chatMessage.trim(),
        title: "Scheduled message",
      };
    }

    try {
      await createSchedulerEntry(selectedProject.id, input);
      setFeedback({ tone: "success", message: "Schedule entry created." });
      setChatMessage("");
      await refresh();
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Failed to create schedule entry." });
    }
  };

  const toggleEntryStatus = async (entryId: string, paused: boolean) => {
    try {
      await updateSchedulerEntry(entryId, { status: paused ? "scheduled" : "paused" });
      await refresh();
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Failed to update schedule entry." });
    }
  };

  const removeEntry = async (entryId: string) => {
    try {
      await deleteSchedulerEntry(entryId);
      await refresh();
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Failed to delete schedule entry." });
    }
  };

  if (!selectedProject) {
    return (
      <PageContainer padding="standard" className="gap-8">
        <ProjectPlaceholder />
      </PageContainer>
    );
  }

  return (
    <PageContainer padding="standard" className="gap-8">
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-signal-500/15 bg-signal-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-400">
            <CalendarDays className="h-3.5 w-3.5" />
            Runtime Scheduler
          </div>
          <h2 className="font-display text-4xl font-black leading-none tracking-tight text-slate-900 dark:text-white md:text-6xl">
            Schedule.
          </h2>
          <p className="mt-4 max-w-2xl text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400 md:text-base">
            Calendar control for future sprint starts, quicksprint launches, and timed messages into the project chat agent.
          </p>
        </div>

        <div className="flex max-w-full flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedDate(addDays(selectedDate, -7))}
            className="min-h-[42px] rounded-full border border-black/[0.06] bg-white/70 px-4 text-xs font-bold text-slate-600 transition hover:text-slate-950 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300 dark:hover:text-white"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setSelectedDate(startOfDay(new Date()))}
            className="min-h-[42px] rounded-full bg-slate-900 px-4 text-xs font-bold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setSelectedDate(addDays(selectedDate, 7))}
            className="min-h-[42px] rounded-full border border-black/[0.06] bg-white/70 px-4 text-xs font-bold text-slate-600 transition hover:text-slate-950 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300 dark:hover:text-white"
          >
            Next
          </button>
          <div className="ml-0 flex rounded-full border border-black/[0.06] bg-white/70 p-1 dark:border-white/[0.08] dark:bg-white/[0.05] lg:ml-2">
            {(["calendar", "day"] as SchedulerView[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setView(item)}
                className={`min-h-[34px] rounded-full px-4 text-[10px] font-bold uppercase tracking-[0.14em] transition ${
                  view === item ? "bg-signal-500 text-void-900" : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                {item === "calendar" ? "Calendar" : "24 Hours"}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        {[
          { label: "Active entries", value: schedulerStats.activeCount, detail: "ready to fire", icon: Play, tone: "text-signal-500" },
          { label: "Repeating", value: schedulerStats.repeatingCount, detail: "recurrence rules", icon: Repeat, tone: "text-sky-500" },
          {
            label: "Next run",
            value: schedulerStats.nextOccurrence ? formatTimeLabel(schedulerStats.nextOccurrence.startsAt) : "None",
            detail: schedulerStats.nextOccurrence ? schedulerStats.nextOccurrence.title : "no upcoming work",
            icon: Clock3,
            tone: "text-ember-500",
          },
        ].map((item) => (
          <div key={item.label} className="relative overflow-hidden rounded-[1.35rem] border border-black/[0.06] bg-white/70 p-4 shadow-[0_14px_38px_rgba(15,23,42,0.06)] backdrop-blur-2xl dark:border-white/[0.07] dark:bg-white/[0.045]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent dark:via-white/18" />
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{item.label}</div>
                <div className="mt-1 truncate font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">{item.value}</div>
                <div className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{item.detail}</div>
              </div>
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-black/[0.035] dark:bg-white/[0.06] ${item.tone}`}>
                <item.icon className="h-5 w-5" strokeWidth={1.8} />
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
        <aside className="rounded-[1.6rem] border border-black/[0.06] bg-white/78 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-2xl dark:border-white/[0.07] dark:bg-[#0f141b]/82">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">Add entry</h3>
              <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">Choose the work, time, and recurrence.</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ember-500/12 text-ember-500">
              <Plus className="h-5 w-5" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {TARGET_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setTargetType(option.value)}
                className={`min-h-[70px] rounded-2xl border p-3 text-left transition ${
                  targetType === option.value
                    ? option.activeClassName
                    : "border-black/[0.06] bg-black/[0.025] hover:bg-black/[0.04] dark:border-white/[0.06] dark:bg-white/[0.035] dark:hover:bg-white/[0.06]"
                }`}
              >
                <option.icon className={`mb-2 h-4 w-4 ${option.tone}`} />
                <span className="block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-600 dark:text-slate-300">{option.label}</span>
              </button>
            ))}
          </div>

          <div className="mt-5 space-y-4">
            {targetType === "sprint" && (
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Sprint</span>
                <AvantgardeSelect
                  value={selectedSprintId}
                  onChange={setSelectedSprintId}
                  searchable={true}
                  options={[
                    { value: "", label: "Choose sprint" },
                    ...incompleteSprints.map((sprint) => ({ value: sprint.id, label: sprint.name }))
                  ]}
                  className="mt-2"
                />
              </label>
            )}

            {targetType === "quicksprint" && (
              <div className="grid gap-3">
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Quicksprint</span>
                  <AvantgardeSelect
                    value={selectedTemplateId}
                    onChange={setSelectedTemplateId}
                    searchable={true}
                    options={[
                      { value: "", label: "Choose template" },
                      ...templates.map((template) => ({ value: template.id, label: template.name }))
                    ]}
                    className="mt-2"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Task count</span>
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
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Message to /chat</span>
                <textarea
                  value={chatMessage}
                  onInput={(event) => setChatMessage(event.currentTarget.value)}
                  rows={5}
                  className={`mt-2 w-full resize-none py-3 font-medium ${SCHEDULER_FIELD_CLASS}`}
                  placeholder="Ask the chat agent to check status, prepare a summary, or start a timed coordination step."
                />
              </label>
            )}

            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Date and time</span>
              <input
                type="datetime-local"
                value={scheduledFor}
                onInput={(event) => setScheduledFor(event.currentTarget.value)}
                className={`mt-2 min-h-[44px] w-full ${SCHEDULER_FIELD_CLASS}`}
              />
              <div className="mt-2 grid grid-cols-3 gap-2">
                {[
                  { label: "In 1h", date: () => { const date = new Date(); date.setHours(date.getHours() + 1, 0, 0, 0); return date; } },
                  { label: "Tomorrow 9", date: () => { const date = addDays(new Date(), 1); date.setHours(9, 0, 0, 0); return date; } },
                  { label: "Monday 9", date: () => { const date = startOfWeek(addDays(new Date(), 7)); date.setHours(9, 0, 0, 0); return date; } },
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
            </label>

            <div className="rounded-2xl border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.035]">
              <label className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                  <Repeat className="h-4 w-4 text-sky-500" />
                  Repeat
                </span>
                <input
                  type="checkbox"
                  checked={repeatEnabled}
                  onChange={(event) => setRepeatEnabled(event.currentTarget.checked)}
                  className="h-5 w-5 accent-signal-500"
                />
              </label>

              {repeatEnabled && (
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
                        { value: "hourly", label: "Hours" },
                        { value: "daily", label: "Days" },
                        { value: "weekly", label: "Weeks" },
                        { value: "monthly", label: "Months" },
                      ]}
                    />
                  </div>

                  <AvantgardeSelect
                    value={endMode}
                    onChange={(value) => setEndMode(value as ScheduleRecurrenceRule["endMode"])}
                    options={[
                      { value: "never", label: "Endless" },
                      { value: "after_count", label: "Specific iterations" },
                      { value: "on_date", label: "End date/time" },
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

            <button
              type="button"
              onClick={() => void submitSchedule()}
              className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-full bg-signal-500 px-5 text-[10px] font-black uppercase tracking-[0.16em] text-void-900 shadow-[0_14px_34px_rgba(0,224,160,0.20)] transition hover:-translate-y-px hover:bg-signal-400"
            >
              <Send className="h-4 w-4" />
              Schedule
            </button>

            {feedback.message && (
              <div className={`rounded-xl px-3 py-2 text-xs font-bold ${
                feedback.tone === "error"
                  ? "bg-status-red/10 text-status-red"
                  : "bg-signal-500/10 text-signal-600 dark:text-signal-400"
              }`}>
                {feedback.message}
              </div>
            )}
          </div>
        </aside>

        <div className="min-w-0 space-y-6">
          <section className="rounded-[1.6rem] border border-black/[0.06] bg-white/74 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.07)] backdrop-blur-2xl dark:border-white/[0.07] dark:bg-[#0f141b]/72 md:p-5">
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                  {view === "calendar" ? "Calendar view" : "24 hour view"}
                </h3>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {loading ? "Refreshing schedule..." : `${schedulerStats.visibleCount} visible occurrences · ${formatDayLabel(range.from)} to ${formatDayLabel(range.to)}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refresh()}
                className="inline-flex min-h-[38px] items-center gap-2 rounded-full border border-black/[0.06] bg-white/80 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 transition hover:text-slate-950 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300 dark:hover:text-white"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
            </div>

            {view === "calendar" ? (
              <div className="grid grid-flow-col auto-cols-[minmax(8.75rem,1fr)] gap-3 overflow-x-auto pb-2 dashboard-scrollbar">
                {weekDays.map((day) => {
                  const key = startOfDay(day).toISOString();
                  const dayItems = occurrencesByDay.get(key) || [];
                  const selected = key === startOfDay(selectedDate).toISOString();
                  const isToday = key === startOfDay(new Date()).toISOString();
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedDate(day)}
                      className={`min-h-[13rem] rounded-2xl border p-3 text-left transition ${
                        selected
                          ? "border-signal-500/35 bg-signal-500/[0.08] shadow-[0_18px_45px_rgba(0,224,160,0.10)]"
                          : "border-black/[0.06] bg-black/[0.02] hover:-translate-y-0.5 hover:bg-black/[0.035] dark:border-white/[0.06] dark:bg-white/[0.025] dark:hover:bg-white/[0.045]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="whitespace-nowrap text-xs font-black uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">{formatDayLabel(day)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${isToday ? "bg-signal-500 text-void-900" : "bg-white/80 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400"}`}>{dayItems.length}</span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {dayItems.slice(0, 5).map((occurrence) => {
                          const option = targetOptionByType.get(occurrence.targetType);
                          return (
                            <div key={occurrence.id} className="rounded-xl border border-white/70 bg-white/82 p-2 text-xs shadow-sm dark:border-white/[0.06] dark:bg-white/[0.055]">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-bold text-slate-800 dark:text-white">{formatTimeLabel(occurrence.startsAt)}</span>
                                <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] ${option?.chipClassName || "bg-slate-500/10 text-slate-500"}`}>{targetLabel(occurrence.targetType)}</span>
                              </div>
                              <div className="mt-1 line-clamp-2 font-semibold text-slate-500 dark:text-slate-400">{occurrence.title}</div>
                            </div>
                          );
                        })}
                        {dayItems.length > 5 && (
                          <div className="text-[10px] font-bold text-slate-400">+{dayItems.length - 5} more</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="max-h-[46rem] space-y-2 overflow-y-auto pr-1 dashboard-scrollbar">
                {Array.from({ length: 24 }, (_item, hour) => {
                  const hourItems = dayOccurrences.filter((occurrence) => new Date(occurrence.startsAt).getHours() === hour);
                  return (
                    <div key={hour} className="grid min-h-[64px] grid-cols-[4.5rem_minmax(0,1fr)] gap-3 rounded-xl border border-black/[0.04] bg-black/[0.015] p-2 dark:border-white/[0.05] dark:bg-white/[0.02]">
                      <div className="pt-2 text-right text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">{pad(hour)}:00</div>
                      <div className="space-y-2 border-l border-black/[0.05] pl-3 dark:border-white/[0.06]">
                        {hourItems.length === 0 && (
                          <div className="h-full min-h-[42px] rounded-xl border border-dashed border-black/[0.04] bg-white/[0.28] dark:border-white/[0.04] dark:bg-white/[0.018]" />
                        )}
                        {hourItems.map((occurrence) => {
                          const option = targetOptionByType.get(occurrence.targetType);
                          return (
                            <div key={occurrence.id} className="rounded-xl border border-white/70 bg-white/82 p-3 shadow-sm dark:border-white/[0.07] dark:bg-white/[0.055]">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="inline-flex items-center gap-2 text-xs font-black text-slate-900 dark:text-white">
                                  <Clock3 className={`h-3.5 w-3.5 ${option?.tone || "text-signal-500"}`} />
                                  {formatTimeLabel(occurrence.startsAt)}
                                </span>
                                <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] ${option?.chipClassName || "bg-slate-500/10 text-slate-500"}`}>
                                  {targetLabel(occurrence.targetType)}
                                </span>
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

          <section className="rounded-[1.6rem] border border-black/[0.06] bg-white/74 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.07)] backdrop-blur-2xl dark:border-white/[0.07] dark:bg-[#0f141b]/72 md:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">Scheduled entries</h3>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Pause, resume, or remove future automation.</p>
              </div>
              <Check className="h-5 w-5 text-signal-500" />
            </div>

            <div className="space-y-3">
              {(schedule?.entries || []).length === 0 && (
                <div className="rounded-2xl border border-dashed border-black/[0.10] p-6 text-sm font-semibold text-slate-500 dark:border-white/[0.10] dark:text-slate-400">
                  No scheduled entries yet.
                </div>
              )}

              {(schedule?.entries || []).map((entry) => {
                const option = targetOptionByType.get(entry.targetType);
                return (
                  <div key={entry.id} className="grid gap-3 rounded-2xl border border-black/[0.06] bg-white/84 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(15,23,42,0.08)] dark:border-white/[0.06] dark:bg-white/[0.048] md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] ${option?.chipClassName || "bg-slate-500/10 text-slate-500"}`}>
                          {targetLabel(entry.targetType)}
                        </span>
                        <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
                          {entry.status}
                        </span>
                        {entry.runCount > 0 && (
                          <span className="rounded-full border border-signal-500/20 bg-signal-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-signal-600 dark:text-signal-400">
                            Fired ({entry.runCount})
                          </span>
                        )}
                        <span className="text-[11px] font-bold text-slate-400">{recurrenceSummary(entry.recurrence)}</span>
                      </div>
                      <h4 className="mt-2 truncate text-sm font-black text-slate-900 dark:text-white">{entry.title}</h4>
                      <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                        Next run: {entry.nextRunAt ? new Date(entry.nextRunAt).toLocaleString() : "none"}
                        {entry.lastRunAt && ` · Last fired: ${new Date(entry.lastRunAt).toLocaleString()}`}
                      </p>
                      {entry.lastError && (
                        <p className="mt-2 text-xs font-bold text-status-red">{entry.lastError}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void toggleEntryStatus(entry.id, entry.status === "paused")}
                        disabled={entry.status === "completed" || entry.status === "cancelled"}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/[0.06] bg-white text-slate-600 transition hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300 dark:hover:text-white"
                        aria-label={entry.status === "paused" ? "Resume schedule entry" : "Pause schedule entry"}
                      >
                        {entry.status === "paused" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeEntry(entry.id)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-status-red/15 bg-status-red/10 text-status-red transition hover:bg-status-red/15"
                        aria-label="Delete schedule entry"
                      >
                        <Trash2 className="h-4 w-4" />
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
