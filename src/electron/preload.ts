import { contextBridge, ipcRenderer } from "electron";

export interface PickDirectoryResult {
  canceled: boolean;
  filePath: string | null;
}

contextBridge.exposeInMainWorld("codeUxDesktop", {
  pickDirectory: (defaultPath?: string): Promise<PickDirectoryResult> => {
    return ipcRenderer.invoke("codeux:pick-directory", defaultPath);
  },
});
