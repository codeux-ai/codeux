export interface AgentEditorNavigationState {
  editorKey: string;
  dirty: boolean;
  pending: boolean;
  save: () => Promise<boolean>;
}

export type AgentEditorNavigationStateChange = (
  editorKey: string,
  state: AgentEditorNavigationState | null,
) => void;
