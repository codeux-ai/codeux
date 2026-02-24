import { h } from 'https://esm.sh/preact';
import { useState, useEffect, useMemo } from 'https://esm.sh/preact/hooks';
import { html } from './utils.js';
import { Header } from './components/Header.js';
import { StatsGrid } from './components/StatsGrid.js';
import { TaskCard } from './components/TaskCard.js';
import { ActivitySidebar } from './components/ActivitySidebar.js';

const DEFAULT_LOG_POLL_INTERVAL_MS = 10000;

const normalizeSessionName = (task) => {
    if (task?.session_name && task.session_name.startsWith('sessions/')) return task.session_name;
    if (task?.session_id) return `sessions/${String(task.session_id).replace(/^sessions\//, '')}`;
    return null;
};

export function App() {
    const [status, setStatus] = useState({ subtasks: [], timestamp: null });
    const [error, setError] = useState(null);
    const [sessionActivities, setSessionActivities] = useState({});

    const fetchData = async () => {
        try {
            const [statusRes, activitiesRes] = await Promise.all([
                fetch('/api/status'),
                fetch('/api/live-activities'),
            ]);
            if (!statusRes.ok || !activitiesRes.ok) {
                throw new Error('Failed to fetch dashboard data');
            }
            const data = await statusRes.json();
            const activitiesData = await activitiesRes.json();
            setStatus(data);
            setSessionActivities(activitiesData.activitiesBySession || {});
            setError(null);
        } catch (err) {
            setError('Unable to connect to Orchestrator API');
        }
    };

    useEffect(() => {
        fetchData();
        const intervalId = setInterval(fetchData, DEFAULT_LOG_POLL_INTERVAL_MS);
        return () => clearInterval(intervalId);
    }, []);

    const tasksWithLiveActivities = useMemo(() => {
        const tasks = status.subtasks || [];
        return tasks.map(task => {
            const sessionName = normalizeSessionName(task);
            const liveActivities = sessionName ? sessionActivities[sessionName] : null;
            if (!liveActivities) return task;
            return { ...task, session_name: sessionName, activities: liveActivities };
        });
    }, [status.subtasks, sessionActivities]);

    const stats = useMemo(() => {
        const tasks = tasksWithLiveActivities || [];
        return {
            total: tasks.length,
            running: tasks.filter(t => t.status === 'RUNNING').length,
            completed: tasks.filter(t => t.status === 'COMPLETED').length,
            failed: tasks.filter(t => t.status === 'FAILED').length,
        };
    }, [tasksWithLiveActivities]);

    if (error) return html`
        <div class="flex items-center justify-center min-h-screen">
            <div class="bg-slate-900/50 backdrop-blur-md border border-slate-800 p-8 rounded-2xl text-center max-w-md">
                <div class="text-red-400 text-5xl mb-4">⚠️</div>
                <h2 class="text-xl font-bold mb-2 text-white">Connection Lost</h2>
                <p class="text-slate-400">${error}</p>
            </div>
        </div>
    `;

    return html`
        <div class="relative min-h-screen flex flex-col">
            <!-- Background Ambient Glow -->
            <div class="fixed top-0 -left-4 w-96 h-96 bg-purple-500/10 rounded-full blur-[128px] pointer-events-none"></div>
            <div class="fixed bottom-0 -right-4 w-96 h-96 bg-blue-500/10 rounded-full blur-[128px] pointer-events-none"></div>

            <${Header} 
                sprint_number=${status.sprint_number} 
                feature_branch=${status.feature_branch} 
                timestamp=${status.timestamp} 
            />

            <main class="flex-grow max-w-7xl mx-auto px-6 py-8 w-full">
                <${StatsGrid} stats=${stats} />

                <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    <!-- Pipeline -->
                    <div class="lg:col-span-8">
                        <div class="flex items-center justify-between mb-6">
                            <h2 class="text-xl font-bold text-white flex items-center gap-2">
                                Task Pipeline
                                <span class="px-2 py-0.5 bg-slate-800 rounded text-xs text-slate-400 font-mono">${stats.total}</span>
                            </h2>
                        </div>

                        <div class="space-y-4">
                            ${stats.total === 0 ? html`
                                <div class="bg-slate-900/50 backdrop-blur-md border border-slate-800 border-dashed p-12 rounded-2xl text-center">
                                    <p class="text-slate-500">Awaiting sprint decomposition...</p>
                                </div>
                            ` : tasksWithLiveActivities.map(task => html`<${TaskCard} key=${task.id} task=${task} />`)}
                        </div>
                    </div>

                    <!-- Activity Sidebar -->
                    <div class="lg:col-span-4">
                        <${ActivitySidebar} 
                            reportText=${status.reportText} 
                            instructions=${status.instructions} 
                        />
                    </div>
                </div>
            </main>
        </div>
    `;
}
