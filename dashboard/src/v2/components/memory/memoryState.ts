import { signal } from "@preact/signals";

export const searchQuerySignal = signal<string>("");
export const activeMemoryIdSignal = signal<string | null>(null);
export const activeTierSignal = signal<"short_term" | "long_term">("short_term");
export const selectedSprintIdSignal = signal<string | undefined>(undefined);
export const selectedAgentPresetIdSignal = signal<string | undefined>(undefined);
