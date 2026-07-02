import { signal } from "@preact/signals";
import type { CreateMemoryInput, MemoryDeleteResult } from "../../lib/memory-api.js";
import type { ActionFeedbackState } from "../../hooks/use-action-feedback.js";

export const searchQuerySignal = signal<string>("");
export const activeMemoryIdSignal = signal<string | null>(null);
export const hoveredMemoryIdSignal = signal<string | null>(null);
export const activeTierSignal = signal<"short_term" | "long_term">("short_term");
export const selectedSprintIdSignal = signal<string | undefined>(undefined);
export const selectedAgentPresetIdSignal = signal<string | undefined>(undefined);
export const lobotomizeModeSignal = signal(false);
export const memoriesSignal = signal<any[]>([]);
export const memorySidebarExpandedSignal = signal<boolean>(false);
export const selectedMemoryIdsSignal = signal<string[]>([]);

const normalizeSelectedMemoryIds = (ids: readonly string[]): string[] => {
    return Array.from(new Set(ids));
};

export const setSelectedMemoryIds = (ids: readonly string[]): void => {
    selectedMemoryIdsSignal.value = normalizeSelectedMemoryIds(ids);
};

export const clearSelectedMemoryIds = (): void => {
    if (selectedMemoryIdsSignal.value.length > 0) {
        selectedMemoryIdsSignal.value = [];
    }
};

export const toggleSelectedMemoryId = (id: string): void => {
    const current = selectedMemoryIdsSignal.value;
    selectedMemoryIdsSignal.value = current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : [...current, id];
};

export const selectVisibleMemoryIds = (ids: readonly string[]): void => {
    setSelectedMemoryIds(ids);
};

export interface MemoryMutationsState {
    addMemory: (input: CreateMemoryInput, pid: string) => Promise<void>;
    removeMemory: (id: string) => void;
    removeMemories: (ids: string[]) => Promise<MemoryDeleteResult[]>;
    feedback: ActionFeedbackState;
    clearFeedback: (message?: string) => void;
    clearError: () => void;
}

export const memoryMutationsSignal = signal<MemoryMutationsState>({
    addMemory: async () => {},
    removeMemory: () => {},
    removeMemories: async () => [],
    feedback: { status: "idle", message: null },
    clearFeedback: () => {},
    clearError: () => {}
});
