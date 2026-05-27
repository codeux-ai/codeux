export {};

declare global {
  interface CodeUxWindowState {
    isMaximized: boolean;
    isFullScreen: boolean;
  }

  interface CodeUxWindowApi {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<boolean>;
    close(): Promise<void>;
    getState(): Promise<CodeUxWindowState & { platform: NodeJS.Platform | string }>;
    onStateChange(listener: (state: CodeUxWindowState) => void): () => void;
  }

  interface Window {
    codeUxDesktop?: {
      platform?: string;
      renderProfile?: "standard" | "low-power";
      pickDirectory(defaultPath?: string): Promise<{
        canceled: boolean;
        filePath: string | null;
      }>;
      setZoom?(factor: number): Promise<number>;
      window?: CodeUxWindowApi;
    };
  }
}
