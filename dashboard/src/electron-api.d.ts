export {};

declare global {
  interface Window {
    codeUxDesktop?: {
      pickDirectory(defaultPath?: string): Promise<{
        canceled: boolean;
        filePath: string | null;
      }>;
    };
  }
}
