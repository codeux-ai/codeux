export const mockStats = {
    dailyTokens: 1450000,
    weeklyTokens: 8200000,
    successRate: 98.4,
    failedJobs: 12,
    dailyFailed: 3,
    weeklyFailed: 9,
    completedJobs: 738,
    dailySuccess: 245,
    weeklySuccess: 493,
    modelDist: {
        gemini: 65,
        claude: 25,
        gpt4: 10,
    }
};

export const mockSources = [
    { id: "src-1", name: "auth-service",     sprintsCount: 2, openTasks: 5,  completedTasks: 12, isRunning: true,  status: "running",      updatedAt: new Date(Date.now() - 1000 * 60 * 5).toISOString() },
    { id: "src-2", name: "payment-gateway",  sprintsCount: 0, openTasks: 0,  completedTasks: 8,  isRunning: false, status: "failed",       updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() },
    { id: "src-3", name: "user-dashboard",   sprintsCount: 1, openTasks: 3,  completedTasks: 4,  isRunning: true,  status: "intervention", updatedAt: new Date(Date.now() - 1000 * 60 * 15).toISOString() },
    { id: "src-4", name: "jules-cli",        sprintsCount: 3, openTasks: 10, completedTasks: 45, isRunning: true,  status: "running",      updatedAt: new Date(Date.now() - 1000 * 60 * 2).toISOString() },
    { id: "src-5", name: "email-templates",  sprintsCount: 0, openTasks: 0,  completedTasks: 1,  isRunning: false, status: "idle",         updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString() },
    { id: "src-6", name: "data-pipeline",    sprintsCount: 1, openTasks: 2,  completedTasks: 9,  isRunning: false, status: "idle",         updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString() },
];

export const mockSprints = [
    { id: "spr-42", name: "Authentication Refactor",  date: "Oct 12 - Oct 26", tasksCount: 24, completion: 100, status: "completed" },
    { id: "spr-43", name: "Dashboard V2 Canvas",      date: "Oct 27 - Nov 10", tasksCount: 38, completion: 65,  status: "running"   },
    { id: "spr-44", name: "Payment Gateway Core",     date: "Nov 11 - Nov 25", tasksCount: 15, completion: 12,  status: "running"   },
    { id: "spr-45", name: "Agentic Orchestration",    date: "Nov 26 - Dec 10", tasksCount: 42, completion: 0,   status: "idle"      },
];

export const mockTasks = [
    // spr-42 — Authentication Refactor (completed)
    { id: 'tsk-001', source: 'auth-service',        sprintId: 'spr-42', sprint: 'Authentication Refactor',  title: 'Migrate OAuth2 to PKCE flow',               status: 'completed',   priority: 'critical', assignee: 'Architect',  time: '3h 45m', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString() },
    { id: 'tsk-002', source: 'auth-service',        sprintId: 'spr-42', sprint: 'Authentication Refactor',  title: 'Add refresh token rotation',                status: 'completed',   priority: 'high',     assignee: 'Debugger',   time: '2h 10m', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 13).toISOString() },
    { id: 'tsk-003', source: 'auth-service',        sprintId: 'spr-42', sprint: 'Authentication Refactor',  title: 'Session invalidation on password change',   status: 'completed',   priority: 'high',     assignee: 'Reviewer',   time: '1h 30m', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString() },
    { id: 'tsk-004', source: 'auth-service',        sprintId: 'spr-42', sprint: 'Authentication Refactor',  title: 'Rate limiting on login endpoints',          status: 'completed',   priority: 'medium',   assignee: 'Tester',     time: '55m',    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 11).toISOString() },

    // spr-43 — Dashboard V2 Canvas (running, 65%)
    { id: 'tsk-005', source: 'codeux',              sprintId: 'spr-43', sprint: 'Dashboard V2 Canvas',      title: 'Implement V2 Dashboard base layout',        status: 'completed',   priority: 'critical', assignee: 'Architect',  time: '4h 20m', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString() },
    { id: 'tsk-006', source: 'codeux',              sprintId: 'spr-43', sprint: 'Dashboard V2 Canvas',      title: 'GSAP entrance animations for all pages',    status: 'completed',   priority: 'high',     assignee: 'Architect',  time: '2h 50m', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 6).toISOString() },
    { id: 'tsk-007', source: 'codeux',              sprintId: 'spr-43', sprint: 'Dashboard V2 Canvas',      title: 'KineticDock magnetic fisheye hover',         status: 'in_progress', priority: 'high',     assignee: 'Debugger',   time: '1h 20m', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString() },
    { id: 'tsk-008', source: 'codeux',              sprintId: 'spr-43', sprint: 'Dashboard V2 Canvas',      title: 'Organic blob cells for sources grid',        status: 'in_progress', priority: 'medium',   assignee: 'Architect',  time: '45m',    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString() },
    { id: 'tsk-009', source: 'codeux',              sprintId: 'spr-43', sprint: 'Dashboard V2 Canvas',      title: 'Sparkline hover re-draw with glow',         status: 'pending',     priority: 'medium',   assignee: 'Reviewer',   time: '--',     createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString() },
    { id: 'tsk-010', source: 'codeux',              sprintId: 'spr-43', sprint: 'Dashboard V2 Canvas',      title: 'Dark/light theme transition polish',         status: 'pending',     priority: 'low',      assignee: 'Tester',     time: '--',     createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString() },
    { id: 'tsk-011', source: 'codeux',              sprintId: 'spr-43', sprint: 'Dashboard V2 Canvas',      title: 'Tasks page with sprint filtering',           status: 'in_progress', priority: 'critical', assignee: 'Architect',  time: '30m',    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() },

    // spr-44 — Payment Gateway Core (running, 12%)
    { id: 'tsk-012', source: 'payment-gateway',     sprintId: 'spr-44', sprint: 'Payment Gateway Core',     title: 'Stripe webhook integration',                status: 'in_progress', priority: 'critical', assignee: 'Debugger',   time: '1h 15m', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString() },
    { id: 'tsk-013', source: 'payment-gateway',     sprintId: 'spr-44', sprint: 'Payment Gateway Core',     title: 'Idempotency keys for charge creation',      status: 'pending',     priority: 'high',     assignee: 'Architect',  time: '--',     createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString() },
    { id: 'tsk-014', source: 'payment-gateway',     sprintId: 'spr-44', sprint: 'Payment Gateway Core',     title: 'PCI-DSS audit trail logging',               status: 'pending',     priority: 'critical', assignee: 'Reviewer',   time: '--',     createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 1).toISOString() },
    { id: 'tsk-015', source: 'payment-gateway',     sprintId: 'spr-44', sprint: 'Payment Gateway Core',     title: 'Refund flow with partial amounts',           status: 'pending',     priority: 'high',     assignee: 'Planner',    time: '--',     createdAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString() },
    { id: 'tsk-016', source: 'payment-gateway',     sprintId: 'spr-44', sprint: 'Payment Gateway Core',     title: 'Currency conversion rounding fixes',         status: 'completed',   priority: 'medium',   assignee: 'Debugger',   time: '40m',    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString() },

    // spr-45 — Agentic Orchestration (idle, 0%)
    { id: 'tsk-017', source: 'jules-cli',           sprintId: 'spr-45', sprint: 'Agentic Orchestration',    title: 'Multi-agent conversation protocol',         status: 'pending',     priority: 'critical', assignee: 'Architect',  time: '--',     createdAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString() },
    { id: 'tsk-018', source: 'jules-cli',           sprintId: 'spr-45', sprint: 'Agentic Orchestration',    title: 'Agent memory persistence layer',             status: 'pending',     priority: 'high',     assignee: 'Planner',    time: '--',     createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString() },
    { id: 'tsk-019', source: 'jules-cli',           sprintId: 'spr-45', sprint: 'Agentic Orchestration',    title: 'Tool use sandboxing and permissions',        status: 'pending',     priority: 'high',     assignee: 'Reviewer',   time: '--',     createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString() },
    { id: 'tsk-020', source: 'jules-cli',           sprintId: 'spr-45', sprint: 'Agentic Orchestration',    title: 'Streaming token output pipeline',            status: 'pending',     priority: 'medium',   assignee: 'Debugger',   time: '--',     createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString() },
    { id: 'tsk-021', source: 'jules-cli',           sprintId: 'spr-45', sprint: 'Agentic Orchestration',    title: 'Context window budget allocator',            status: 'pending',     priority: 'medium',   assignee: 'Architect',  time: '--',     createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() },
    { id: 'tsk-022', source: 'jules-cli',           sprintId: 'spr-45', sprint: 'Agentic Orchestration',    title: 'Agent handoff and delegation chains',        status: 'pending',     priority: 'low',      assignee: 'Tester',     time: '--',     createdAt: new Date(Date.now() - 1000 * 60 * 60 * 1).toISOString() },
];
