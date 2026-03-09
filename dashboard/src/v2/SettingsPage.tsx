import type { FunctionComponent, ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import {
    SlidersHorizontal, Cpu, Paintbrush, Bell, Target,
    Shield, Plug, AlertTriangle, Settings, Check,
    Eye, EyeOff, ChevronDown, ExternalLink, Zap,
} from "lucide-preact";

/* ─── Category config ────────────────────────────────────────────────────── */

type CategoryId =
    | 'general' | 'models' | 'appearance' | 'notifications'
    | 'sprint' | 'security' | 'integrations' | 'danger';

interface Category {
    id: CategoryId;
    num: string;
    label: string;
    description: string;
    icon: typeof Settings;
    danger?: boolean;
}

const CATEGORIES: Category[] = [
    { id: 'general',       num: '01', label: 'General',       icon: SlidersHorizontal, description: 'Workspace identity and core defaults'    },
    { id: 'models',        num: '02', label: 'AI Models',      icon: Cpu,               description: 'Model selection, tokens, and parameters' },
    { id: 'appearance',    num: '03', label: 'Appearance',     icon: Paintbrush,        description: 'Theme, density, and motion preferences'  },
    { id: 'notifications', num: '04', label: 'Notifications',  icon: Bell,              description: 'Alerts, digests, and webhook events'      },
    { id: 'sprint',        num: '05', label: 'Sprint Engine',  icon: Target,            description: 'Iteration cycles and velocity tracking'   },
    { id: 'security',      num: '06', label: 'Security',       icon: Shield,            description: 'API keys, sessions, and audit logging'    },
    { id: 'integrations',  num: '07', label: 'Integrations',   icon: Plug,              description: 'GitHub, Slack, Datadog, and more'         },
    { id: 'danger',        num: '08', label: 'Danger Zone',    icon: AlertTriangle,     description: 'Destructive and irreversible operations', danger: true },
];

/* ─── Settings state ─────────────────────────────────────────────────────── */

interface S {
    workspaceName:         string;
    timezone:              string;
    defaultProject:        string;
    autoSave:              boolean;
    primaryModel:          string;
    fallbackModel:         string;
    maxTokens:             number;
    temperature:           string;
    streaming:             boolean;
    reduceMotion:          boolean;
    denseLayout:           boolean;
    fontSize:              string;
    sprintAlerts:          boolean;
    agentFailureAlerts:    boolean;
    taskAlerts:            boolean;
    weeklyDigest:          boolean;
    notifSound:            boolean;
    sprintDuration:        string;
    autoArchive:           boolean;
    velocityTracking:      boolean;
    retrospectiveReminders:boolean;
    apiKeyVisible:         boolean;
    sessionTimeout:        string;
    twoFactor:             boolean;
    auditLogging:          boolean;
    githubEnabled:         boolean;
    slackEnabled:          boolean;
    slackWebhook:          string;
    datadogEnabled:        boolean;
    linearSync:            boolean;
}

const DEFAULT: S = {
    workspaceName:          'Jules Workspace',
    timezone:               'UTC',
    defaultProject:         'jules-cli',
    autoSave:               true,
    primaryModel:           'claude-sonnet-4-6',
    fallbackModel:          'claude-haiku-4-5',
    maxTokens:              8192,
    temperature:            '0.3',
    streaming:              true,
    reduceMotion:           false,
    denseLayout:            false,
    fontSize:               'base',
    sprintAlerts:           true,
    agentFailureAlerts:     true,
    taskAlerts:             false,
    weeklyDigest:           true,
    notifSound:             false,
    sprintDuration:         '2w',
    autoArchive:            true,
    velocityTracking:       true,
    retrospectiveReminders: false,
    apiKeyVisible:          false,
    sessionTimeout:         '8h',
    twoFactor:              false,
    auditLogging:           true,
    githubEnabled:          true,
    slackEnabled:           false,
    slackWebhook:           '',
    datadogEnabled:         false,
    linearSync:             false,
};

/* ─── Primitives ─────────────────────────────────────────────────────────── */

const Toggle: FunctionComponent<{ value: boolean; onChange: () => void; danger?: boolean }> = ({ value, onChange, danger }) => (
    <button
        onClick={onChange}
        className={`relative w-11 h-6 rounded-full transition-[background-color,box-shadow] duration-300 shrink-0 focus:outline-none
            ${value
                ? danger
                    ? 'bg-status-red shadow-[0_0_12px_rgba(227,0,15,0.35)]'
                    : 'bg-signal-500 shadow-[0_0_12px_rgba(0,224,160,0.35)]'
                : 'bg-black/[0.1] dark:bg-white/[0.1]'
            }`}
    >
        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white
                         shadow-[0_1px_4px_rgba(0,0,0,0.2)]
                         transition-transform duration-300 ease-out
                         ${value ? 'translate-x-[1.375rem]' : 'translate-x-0.5'}`}
        />
    </button>
);

const SelectInput: FunctionComponent<{ value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }> = ({ value, onChange, options }) => (
    <div className="relative">
        <select
            value={value}
            onChange={(e) => onChange(e.currentTarget.value)}
            className="appearance-none bg-black/[0.04] dark:bg-white/[0.04]
                       border border-black/[0.06] dark:border-white/[0.06]
                       rounded-xl px-3 py-2 pr-8
                       text-sm font-mono text-slate-700 dark:text-slate-200
                       focus:outline-none focus:border-signal-500/40
                       focus:ring-2 focus:ring-signal-500/10
                       transition-colors duration-200 cursor-pointer min-w-[140px]"
        >
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" strokeWidth={2} />
    </div>
);

const TextInput: FunctionComponent<{ value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }> = ({ value, onChange, placeholder, mono }) => (
    <input
        type="text"
        value={value}
        placeholder={placeholder}
        onInput={(e) => onChange(e.currentTarget.value)}
        className={`bg-black/[0.04] dark:bg-white/[0.04]
                   border border-black/[0.06] dark:border-white/[0.06]
                   rounded-xl px-3 py-2 text-sm
                   ${mono ? 'font-mono' : 'font-sans'}
                   text-slate-700 dark:text-slate-200
                   placeholder-slate-400
                   focus:outline-none focus:border-signal-500/40
                   focus:ring-2 focus:ring-signal-500/10
                   transition-colors duration-200 min-w-[200px]`}
    />
);

const NumberInput: FunctionComponent<{ value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }> = ({ value, onChange, min, max, step = 1 }) => (
    <input
        type="number"
        value={value}
        min={min} max={max} step={step}
        onInput={(e) => onChange(Number(e.currentTarget.value))}
        className="bg-black/[0.04] dark:bg-white/[0.04]
                   border border-black/[0.06] dark:border-white/[0.06]
                   rounded-xl px-3 py-2 w-28
                   text-sm font-mono text-slate-700 dark:text-slate-200
                   focus:outline-none focus:border-signal-500/40
                   focus:ring-2 focus:ring-signal-500/10
                   transition-colors duration-200"
    />
);

/* ─── Setting row ────────────────────────────────────────────────────────── */

const Row: FunctionComponent<{
    label: string;
    description?: string;
    children: ComponentChildren;
    last?: boolean;
}> = ({ label, description, children, last }) => (
    <div className={`flex items-center justify-between gap-6 py-4.5
                    ${!last ? 'border-b border-black/[0.05] dark:border-white/[0.04]' : ''}`}
         style={{ paddingTop: '1.125rem', paddingBottom: '1.125rem' }}>
        <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-snug">{label}</div>
            {description && (
                <div className="text-xs text-slate-400 font-medium mt-0.5 leading-relaxed">{description}</div>
            )}
        </div>
        <div className="shrink-0">{children}</div>
    </div>
);

/* ─── Section card ───────────────────────────────────────────────────────── */

const SectionCard: FunctionComponent<{ title: string; watermark: string; children: ComponentChildren; danger?: boolean }> = ({
    title, watermark, children, danger,
}) => (
    <div className="relative overflow-hidden
                    bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl
                    border border-black/[0.06] dark:border-white/[0.06]
                    rounded-[1.75rem]
                    shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
        {/* Ghost watermark */}
        <div
            aria-hidden
            className={`absolute -right-4 -bottom-6 text-[7rem] font-black tracking-tighter
                        pointer-events-none select-none font-display leading-none
                        ${danger ? 'text-status-red/[0.04]' : 'text-black/[0.025] dark:text-white/[0.02]'}`}
        >
            {watermark}
        </div>

        {/* Section title bar */}
        <div className={`px-7 py-5 border-b border-black/[0.05] dark:border-white/[0.04]
                        ${danger ? 'bg-status-red/[0.03]' : ''}`}>
            <h3 className={`text-[11px] font-bold uppercase tracking-[0.18em]
                           ${danger ? 'text-status-red/70' : 'text-slate-400 dark:text-slate-500'}`}>
                {title}
            </h3>
        </div>

        <div className="px-7 relative z-10">
            {children}
        </div>
    </div>
);

/* ─── Danger button ──────────────────────────────────────────────────────── */

const DangerRow: FunctionComponent<{ label: string; description: string; action: string; last?: boolean }> = ({
    label, description, action, last,
}) => (
    <div className={`flex items-center justify-between gap-6 py-5
                    ${!last ? 'border-b border-black/[0.05] dark:border-white/[0.04]' : ''}`}>
        <div>
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</div>
            <div className="text-xs text-slate-400 font-medium mt-0.5">{description}</div>
        </div>
        <button className="px-4 py-2 rounded-xl border border-status-red/30 dark:border-status-red/25
                           bg-status-red/[0.06] hover:bg-status-red/[0.12]
                           text-status-red text-xs font-bold
                           transition-colors duration-200 shrink-0
                           shadow-[0_0_16px_rgba(227,0,15,0.06)] hover:shadow-[0_0_20px_rgba(227,0,15,0.12)]">
            {action}
        </button>
    </div>
);

/* ─── Integration row ────────────────────────────────────────────────────── */

const IntegrationRow: FunctionComponent<{
    label: string; description: string;
    connected: boolean; onToggle: () => void;
    last?: boolean;
}> = ({ label, description, connected, onToggle, last }) => (
    <div className={`flex items-center justify-between gap-6 py-4.5
                    ${!last ? 'border-b border-black/[0.05] dark:border-white/[0.04]' : ''}`}
         style={{ paddingTop: '1.125rem', paddingBottom: '1.125rem' }}>
        <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full shrink-0
                ${connected
                    ? 'bg-status-green shadow-[0_0_8px_rgba(0,171,132,0.6)] animate-pulse'
                    : 'bg-slate-300 dark:bg-slate-600'}`}
            />
            <div>
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</div>
                <div className="text-xs text-slate-400 font-medium mt-0.5">{description}</div>
            </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
            {connected && (
                <button className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors duration-200">
                    <ExternalLink className="w-3 h-3" strokeWidth={2} />
                    Configure
                </button>
            )}
            <Toggle value={connected} onChange={onToggle} />
        </div>
    </div>
);

/* ─── Section content per category ──────────────────────────────────────── */

const GeneralSection: FunctionComponent<{ s: S; set: (k: keyof S, v: any) => void }> = ({ s, set }) => (
    <div className="flex flex-col gap-5">
        <SectionCard title="Workspace" watermark="WRK">
            <Row label="Workspace name" description="Displayed in the TopNav and exported reports">
                <TextInput value={s.workspaceName} onChange={v => set('workspaceName', v)} placeholder="My Workspace" />
            </Row>
            <Row label="Timezone" description="Used for sprint scheduling and digest timestamps">
                <SelectInput value={s.timezone} onChange={v => set('timezone', v)} options={[
                    { value: 'UTC',       label: 'UTC' },
                    { value: 'US/Eastern',label: 'US / Eastern' },
                    { value: 'US/Pacific',label: 'US / Pacific' },
                    { value: 'Europe/London', label: 'Europe / London' },
                    { value: 'Europe/Berlin', label: 'Europe / Berlin' },
                    { value: 'Asia/Tokyo',    label: 'Asia / Tokyo' },
                ]} />
            </Row>
            <Row label="Default project" description="Pre-selected in the TopNav project switcher">
                <SelectInput value={s.defaultProject} onChange={v => set('defaultProject', v)} options={[
                    { value: 'jules-cli',       label: 'jules-cli'       },
                    { value: 'auth-service',    label: 'auth-service'    },
                    { value: 'user-dashboard',  label: 'user-dashboard'  },
                    { value: 'payment-gateway', label: 'payment-gateway' },
                ]} />
            </Row>
            <Row label="Auto-save" description="Persist unsaved changes automatically every 30 seconds" last>
                <Toggle value={s.autoSave} onChange={() => set('autoSave', !s.autoSave)} />
            </Row>
        </SectionCard>
    </div>
);

const ModelsSection: FunctionComponent<{ s: S; set: (k: keyof S, v: any) => void }> = ({ s, set }) => (
    <div className="flex flex-col gap-5">
        <SectionCard title="Model Selection" watermark="MDL">
            <Row label="Primary model" description="Used for all agent tasks and Chat requests by default">
                <SelectInput value={s.primaryModel} onChange={v => set('primaryModel', v)} options={[
                    { value: 'claude-opus-4-6',   label: 'Claude Opus 4.6'   },
                    { value: 'claude-sonnet-4-6',  label: 'Claude Sonnet 4.6' },
                    { value: 'claude-haiku-4-5',   label: 'Claude Haiku 4.5'  },
                ]} />
            </Row>
            <Row label="Fallback model" description="Engaged when primary model is rate-limited or unavailable" last>
                <SelectInput value={s.fallbackModel} onChange={v => set('fallbackModel', v)} options={[
                    { value: 'claude-sonnet-4-6',  label: 'Claude Sonnet 4.6' },
                    { value: 'claude-haiku-4-5',   label: 'Claude Haiku 4.5'  },
                ]} />
            </Row>
        </SectionCard>
        <SectionCard title="Parameters" watermark="PRM">
            <Row label="Max tokens per request" description="Hard ceiling on output length — affects cost and latency">
                <NumberInput value={s.maxTokens} onChange={v => set('maxTokens', v)} min={512} max={32000} step={512} />
            </Row>
            <Row label="Temperature" description="0.0 = deterministic · 1.0 = creative. Agents use lower values">
                <SelectInput value={s.temperature} onChange={v => set('temperature', v)} options={[
                    { value: '0.0', label: '0.0 — Deterministic' },
                    { value: '0.3', label: '0.3 — Precise'       },
                    { value: '0.5', label: '0.5 — Balanced'      },
                    { value: '0.7', label: '0.7 — Creative'      },
                    { value: '1.0', label: '1.0 — Chaotic'       },
                ]} />
            </Row>
            <Row label="Streaming responses" description="Stream tokens progressively — reduces perceived latency" last>
                <Toggle value={s.streaming} onChange={() => set('streaming', !s.streaming)} />
            </Row>
        </SectionCard>
    </div>
);

const AppearanceSection: FunctionComponent<{ s: S; set: (k: keyof S, v: any) => void }> = ({ s, set }) => (
    <div className="flex flex-col gap-5">
        <SectionCard title="Display" watermark="DSP">
            <Row label="Dense layout" description="Reduce whitespace and padding for higher information density">
                <Toggle value={s.denseLayout} onChange={() => set('denseLayout', !s.denseLayout)} />
            </Row>
            <Row label="Font size" description="Base type scale used across all UI text">
                <SelectInput value={s.fontSize} onChange={v => set('fontSize', v)} options={[
                    { value: 'sm',   label: 'Small'  },
                    { value: 'base', label: 'Default' },
                    { value: 'lg',   label: 'Large'  },
                ]} />
            </Row>
            <Row label="Reduce motion" description="Disable GSAP entrance animations and ambient effects" last>
                <Toggle value={s.reduceMotion} onChange={() => set('reduceMotion', !s.reduceMotion)} />
            </Row>
        </SectionCard>
    </div>
);

const NotificationsSection: FunctionComponent<{ s: S; set: (k: keyof S, v: any) => void }> = ({ s, set }) => (
    <div className="flex flex-col gap-5">
        <SectionCard title="Alert Types" watermark="ALT">
            <Row label="Sprint completion" description="Notify when a sprint reaches 100% or is manually closed">
                <Toggle value={s.sprintAlerts} onChange={() => set('sprintAlerts', !s.sprintAlerts)} />
            </Row>
            <Row label="Agent failures" description="Immediate alert when an agent encounters an unrecoverable error">
                <Toggle value={s.agentFailureAlerts} onChange={() => set('agentFailureAlerts', !s.agentFailureAlerts)} />
            </Row>
            <Row label="Task assignments" description="Notify when a task is routed to you for manual intervention">
                <Toggle value={s.taskAlerts} onChange={() => set('taskAlerts', !s.taskAlerts)} />
            </Row>
            <Row label="Weekly digest" description="Sunday evening summary of velocity, completions, and blockers" last>
                <Toggle value={s.weeklyDigest} onChange={() => set('weeklyDigest', !s.weeklyDigest)} />
            </Row>
        </SectionCard>
        <SectionCard title="Delivery" watermark="DLV">
            <Row label="Notification sound" description="Play a subtle chime for real-time alerts" last>
                <Toggle value={s.notifSound} onChange={() => set('notifSound', !s.notifSound)} />
            </Row>
        </SectionCard>
    </div>
);

const SprintSection: FunctionComponent<{ s: S; set: (k: keyof S, v: any) => void }> = ({ s, set }) => (
    <div className="flex flex-col gap-5">
        <SectionCard title="Iteration Settings" watermark="SPR">
            <Row label="Default sprint duration" description="Pre-filled when creating a new sprint">
                <SelectInput value={s.sprintDuration} onChange={v => set('sprintDuration', v)} options={[
                    { value: '1w', label: '1 week'  },
                    { value: '2w', label: '2 weeks' },
                    { value: '3w', label: '3 weeks' },
                    { value: '4w', label: '4 weeks' },
                ]} />
            </Row>
            <Row label="Auto-archive completed sprints" description="Move completed sprints to archive after 7 days">
                <Toggle value={s.autoArchive} onChange={() => set('autoArchive', !s.autoArchive)} />
            </Row>
            <Row label="Velocity tracking" description="Calculate and display story points per sprint on the dashboard">
                <Toggle value={s.velocityTracking} onChange={() => set('velocityTracking', !s.velocityTracking)} />
            </Row>
            <Row label="Retrospective reminders" description="Prompt for a retrospective 24h after sprint closes" last>
                <Toggle value={s.retrospectiveReminders} onChange={() => set('retrospectiveReminders', !s.retrospectiveReminders)} />
            </Row>
        </SectionCard>
    </div>
);

const SecuritySection: FunctionComponent<{ s: S; set: (k: keyof S, v: any) => void }> = ({ s, set }) => (
    <div className="flex flex-col gap-5">
        <SectionCard title="Credentials" watermark="SEC">
            <Row label="API key" description="Anthropic API key used by all agents and Chat">
                <div className="flex items-center gap-2">
                    <input
                        type={s.apiKeyVisible ? 'text' : 'password'}
                        value="sk-ant-api03-••••••••••••••••••••••••••••••"
                        readOnly
                        className="bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.06]
                                   rounded-xl px-3 py-2 text-sm font-mono text-slate-500 dark:text-slate-400
                                   focus:outline-none w-56 cursor-default"
                    />
                    <button
                        onClick={() => set('apiKeyVisible', !s.apiKeyVisible)}
                        className="w-9 h-9 flex items-center justify-center rounded-xl
                                   bg-black/[0.04] dark:bg-white/[0.04]
                                   hover:bg-black/[0.08] dark:hover:bg-white/[0.08]
                                   text-slate-400 hover:text-slate-700 dark:hover:text-slate-200
                                   transition-colors duration-200"
                    >
                        {s.apiKeyVisible
                            ? <EyeOff className="w-4 h-4" strokeWidth={1.75} />
                            : <Eye className="w-4 h-4" strokeWidth={1.75} />
                        }
                    </button>
                </div>
            </Row>
            <Row label="Session timeout" description="Automatically lock after inactivity">
                <SelectInput value={s.sessionTimeout} onChange={v => set('sessionTimeout', v)} options={[
                    { value: '1h',  label: '1 hour'   },
                    { value: '4h',  label: '4 hours'  },
                    { value: '8h',  label: '8 hours'  },
                    { value: '24h', label: '24 hours' },
                    { value: 'never', label: 'Never'  },
                ]} />
            </Row>
            <Row label="Two-factor authentication" description="Require TOTP on each new session">
                <Toggle value={s.twoFactor} onChange={() => set('twoFactor', !s.twoFactor)} />
            </Row>
            <Row label="Audit logging" description="Persist a full log of all agent actions and config changes" last>
                <Toggle value={s.auditLogging} onChange={() => set('auditLogging', !s.auditLogging)} />
            </Row>
        </SectionCard>
    </div>
);

const IntegrationsSection: FunctionComponent<{ s: S; set: (k: keyof S, v: any) => void }> = ({ s, set }) => (
    <div className="flex flex-col gap-5">
        <SectionCard title="Connected Services" watermark="INT">
            <IntegrationRow label="GitHub" description="Read repository context, push branches, open pull requests" connected={s.githubEnabled} onToggle={() => set('githubEnabled', !s.githubEnabled)} />
            <IntegrationRow label="Slack" description="Post sprint summaries and agent alerts to channels" connected={s.slackEnabled} onToggle={() => set('slackEnabled', !s.slackEnabled)} />
            <IntegrationRow label="Datadog" description="Emit custom metrics for token usage, velocity, and error rates" connected={s.datadogEnabled} onToggle={() => set('datadogEnabled', !s.datadogEnabled)} />
            <IntegrationRow label="Linear" description="Sync sprint tasks bidirectionally with Linear issues" connected={s.linearSync} onToggle={() => set('linearSync', !s.linearSync)} last />
        </SectionCard>
        {s.slackEnabled && (
            <SectionCard title="Slack Configuration" watermark="SLK">
                <Row label="Webhook URL" description="Incoming webhook endpoint for your Slack workspace" last>
                    <TextInput value={s.slackWebhook} onChange={v => set('slackWebhook', v)} placeholder="https://hooks.slack.com/…" mono />
                </Row>
            </SectionCard>
        )}
    </div>
);

const DangerSection: FunctionComponent = () => (
    <div className="flex flex-col gap-5">
        <SectionCard title="Destructive Operations" watermark="!!!" danger>
            <DangerRow label="Clear agent memories" description="Permanently deletes all stored memories across every agent. This cannot be undone." action="Clear All" />
            <DangerRow label="Reset sprint history" description="Removes all completed sprint records from the database. Active sprints are unaffected." action="Reset" />
            <DangerRow label="Export workspace data" description="Download a full JSON archive of all projects, agents, sprints, and settings." action="Export" />
            <DangerRow label="Delete workspace" description="Permanently destroys this workspace and all associated data. Requires confirmation." action="Delete Workspace" last />
        </SectionCard>
    </div>
);

/* ─── Settings Page ──────────────────────────────────────────────────────── */

export const SettingsPage: FunctionComponent = () => {
    const headerRef  = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    const [active, setActive]   = useState<CategoryId>('general');
    const [s, setS]             = useState<S>(DEFAULT);
    const [saved, setSaved]     = useState(false);

    const set = (k: keyof S, v: any) => setS(prev => ({ ...prev, [k]: v }));

    useLayoutEffect(() => {
        if (headerRef.current) {
            gsap.fromTo(Array.from(headerRef.current.children),
                { opacity: 0, y: 40 },
                { opacity: 1, y: 0, stagger: 0.09, duration: 0.9, ease: "power4.out", delay: 0.05 },
            );
        }
    }, []);

    /* Animate content swap on category change */
    const switchCategory = (id: CategoryId) => {
        if (!contentRef.current || id === active) return;
        gsap.to(contentRef.current, {
            opacity: 0, y: 12, duration: 0.18, ease: "power2.in",
            onComplete: () => {
                setActive(id);
                gsap.fromTo(contentRef.current,
                    { opacity: 0, y: 12 },
                    { opacity: 1, y: 0, duration: 0.35, ease: "power3.out" },
                );
            },
        });
    };

    const handleSave = () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2400);
    };

    const activeCat = CATEGORIES.find(c => c.id === active)!;

    return (
        <div className="max-w-[1920px] mx-auto px-8 md:px-20 py-24 flex flex-col gap-16 relative z-10">

            {/* ── Ambient glows ────────────────────────────────────── */}
            <div aria-hidden className="fixed inset-0 pointer-events-none -z-10">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_-5%_-10%,rgba(0,224,160,0.04)_0%,transparent_60%)]
                               dark:bg-[radial-gradient(ellipse_60%_50%_at_-5%_-10%,rgba(0,224,160,0.06)_0%,transparent_60%)]" />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_110%_110%,rgba(255,184,0,0.025)_0%,transparent_60%)]
                               dark:bg-[radial-gradient(ellipse_50%_40%_at_110%_110%,rgba(255,184,0,0.04)_0%,transparent_60%)]" />
            </div>

            {/* ── Page header ───────────────────────────────────────── */}
            <div ref={headerRef} className="flex items-end justify-between gap-8">
                <div className="flex flex-col gap-5">
                    <div className="flex items-center gap-2.5 text-slate-400 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                        <Settings className="w-3.5 h-3.5" strokeWidth={2.5} />
                        Configuration
                    </div>

                    <div className="relative overflow-hidden">
                        <h2
                            aria-hidden
                            className="absolute -top-10 -left-3 text-[7rem] font-black tracking-tighter
                                       text-black/[0.04] dark:text-white/[0.03]
                                       pointer-events-none select-none font-display leading-none"
                        >
                            CONF
                        </h2>
                        <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-slate-900 dark:text-white leading-[0.92] font-display relative z-10">
                            System <br />
                            <span className="text-slate-400 dark:text-slate-500">Settings.</span>
                        </h1>
                    </div>

                    <p className="text-lg text-slate-500 dark:text-slate-500 font-medium max-w-xl mt-1 leading-relaxed">
                        Configure your workspace, AI models, integrations, and system preferences.
                    </p>
                </div>

                {/* Save button */}
                <div className="shrink-0">
                    <button
                        onClick={handleSave}
                        className={`group flex items-center gap-2.5 px-6 py-3.5 rounded-2xl font-bold text-sm
                                   transition-[background-color,box-shadow,transform] duration-300
                                   hover:-translate-y-px
                                   ${saved
                                       ? 'bg-status-green text-white shadow-[0_4px_20px_rgba(0,171,132,0.3)]'
                                       : 'bg-slate-900 dark:bg-white hover:bg-slate-700 dark:hover:bg-slate-100 text-white dark:text-void-900 shadow-[0_4px_12px_rgba(0,0,0,0.15)]'
                                   }`}
                    >
                        {saved ? (
                            <>
                                <Check className="w-4 h-4" strokeWidth={2.5} />
                                Saved
                            </>
                        ) : (
                            <>
                                <Zap className="w-4 h-4 group-hover:scale-110 transition-transform duration-200" strokeWidth={2} />
                                Save Changes
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* ── Two-column layout ─────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-8 items-start">

                {/* ── Category nav ───────────────────────────────────── */}
                <div className="sticky top-24 flex flex-col gap-1
                                bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl
                                border border-black/[0.06] dark:border-white/[0.06]
                                rounded-[1.75rem] p-3
                                shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">

                    {/* Nav label */}
                    <div className="px-4 pt-2 pb-3">
                        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-600">
                            Categories
                        </span>
                    </div>

                    {CATEGORIES.map(cat => {
                        const isActive  = active === cat.id;
                        const isDanger  = cat.danger;
                        return (
                            <button
                                key={cat.id}
                                onClick={() => switchCategory(cat.id)}
                                className={`relative group flex items-center gap-3.5 px-4 py-3.5 rounded-[1.1rem] w-full text-left
                                           transition-colors duration-200
                                           ${isActive
                                               ? isDanger
                                                   ? 'bg-status-red/[0.07] dark:bg-status-red/[0.08]'
                                                   : 'bg-signal-500/[0.08] dark:bg-signal-500/[0.1]'
                                               : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                                           }`}
                            >
                                {/* Active left accent */}
                                {isActive && (
                                    <div className={`absolute left-0 top-3 bottom-3 w-[2.5px] rounded-full
                                        ${isDanger ? 'bg-status-red' : 'bg-signal-500'}`}
                                    />
                                )}

                                {/* Number */}
                                <span className="text-[9px] font-mono font-bold text-slate-300 dark:text-slate-600 shrink-0 w-5 text-right">
                                    {cat.num}
                                </span>

                                {/* Icon */}
                                <cat.icon
                                    className={`w-4 h-4 shrink-0 transition-colors duration-200
                                        ${isActive
                                            ? isDanger ? 'text-status-red' : 'text-signal-500'
                                            : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300'
                                        }`}
                                    strokeWidth={1.75}
                                />

                                {/* Label */}
                                <div className="flex-1 min-w-0">
                                    <div className={`text-sm font-semibold transition-colors duration-200
                                        ${isActive
                                            ? isDanger ? 'text-status-red' : 'text-signal-600 dark:text-signal-400'
                                            : 'text-slate-700 dark:text-slate-300'
                                        }`}>
                                        {cat.label}
                                    </div>
                                    <div className="text-[10px] text-slate-400 dark:text-slate-600 font-medium mt-0.5 leading-tight truncate">
                                        {cat.description}
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* ── Settings content ───────────────────────────────── */}
                <div ref={contentRef} className="flex flex-col gap-5 min-w-0">
                    {/* Section eyebrow */}
                    <div className="flex items-center gap-3 mb-1">
                        <activeCat.icon
                            className={`w-4 h-4 ${activeCat.danger ? 'text-status-red' : 'text-signal-500'}`}
                            strokeWidth={2}
                        />
                        <span className={`text-[10px] font-bold uppercase tracking-[0.2em] font-mono
                            ${activeCat.danger ? 'text-status-red/70' : 'text-signal-500'}`}>
                            {activeCat.label}
                        </span>
                        <div className="flex-1 h-px bg-gradient-to-r from-black/[0.06] dark:from-white/[0.06] to-transparent" />
                    </div>

                    {active === 'general'       && <GeneralSection s={s} set={set} />}
                    {active === 'models'        && <ModelsSection s={s} set={set} />}
                    {active === 'appearance'    && <AppearanceSection s={s} set={set} />}
                    {active === 'notifications' && <NotificationsSection s={s} set={set} />}
                    {active === 'sprint'        && <SprintSection s={s} set={set} />}
                    {active === 'security'      && <SecuritySection s={s} set={set} />}
                    {active === 'integrations'  && <IntegrationsSection s={s} set={set} />}
                    {active === 'danger'        && <DangerSection />}
                </div>
            </div>
        </div>
    );
};
