import { contextBridge, ipcRenderer } from "electron";

export interface PickDirectoryResult {
  canceled: boolean;
  filePath: string | null;
}

export interface WindowState {
  isMaximized: boolean;
  isFullScreen: boolean;
  platform: NodeJS.Platform;
}

// Under WSL the GPU is software-rasterized (WebGL2 is blocklisted) and requestAnimationFrame has
// no vsync to pace it, so animated WebGL/canvas backgrounds busy-spin and peg the renderer. Report
// a low-power profile so the dashboard falls back to a static background and avoids the freeze.
const isWsl = Boolean(process.env.WSL_DISTRO_NAME)
  || Boolean(process.env.WSL_INTEROP)
  || /microsoft|wsl/i.test(process.env.WSL_DISTRO_NAME || "");

contextBridge.exposeInMainWorld("codeUxDesktop", {
  platform: process.platform,
  renderProfile: isWsl ? "low-power" : "standard",
  pickDirectory: (defaultPath?: string): Promise<PickDirectoryResult> => {
    return ipcRenderer.invoke("codeux:pick-directory", defaultPath);
  },
  setZoom: (factor: number): Promise<number> => {
    return ipcRenderer.invoke("codeux:set-zoom", factor);
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke("codeux:window-minimize"),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke("codeux:window-toggle-maximize"),
    close: (): Promise<void> => ipcRenderer.invoke("codeux:window-close"),
    getState: (): Promise<WindowState> => ipcRenderer.invoke("codeux:window-state"),
    onStateChange: (listener: (state: Omit<WindowState, "platform">) => void): (() => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, state: Omit<WindowState, "platform">) => listener(state);
      ipcRenderer.on("codeux:window-state", wrapped);
      return () => ipcRenderer.removeListener("codeux:window-state", wrapped);
    },
  },
});

