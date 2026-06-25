import { signal } from "@preact/signals";

export const searchQuerySignal = signal<string>("");
export const activeMemoryIdSignal = signal<string | null>(null);
export const hoveredMemoryIdSignal = signal<string | null>(null);
export const activeTierSignal = signal<"short_term" | "long_term">("short_term");
export const selectedSprintIdSignal = signal<string | undefined>(undefined);
export const selectedAgentPresetIdSignal = signal<string | undefined>(undefined);
export const lobotomizeModeSignal = signal(false);
export const memoriesSignal = signal<any[]>([]);
export const memorySidebarExpandedSignal = signal<boolean>(true);

export const memoryMutationsSignal = signal<any>({
    addMemory: async (input: any, pid: string) => {},
    removeMemory: (id: string) => {},
    feedback: { status: "idle", message: null },
    clearFeedback: () => {}
});
