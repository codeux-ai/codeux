export const CODE_UX_RELEASES_LATEST_URL = "https://github.com/codeux-ai/codeux/releases/latest";

export interface MaximizableWindowTarget {
  isMaximized(): boolean;
  maximize(): void;
  unmaximize(): void;
}

export interface ExternalShellTarget {
  openExternal(url: string): Promise<unknown> | unknown;
}

export const toggleWindowMaximized = (target: MaximizableWindowTarget): boolean => {
  if (target.isMaximized()) {
    target.unmaximize();
  } else {
    target.maximize();
  }

  return target.isMaximized();
};

export const openCodeUxUpdatesPage = async (target: ExternalShellTarget): Promise<boolean> => {
  try {
    await target.openExternal(CODE_UX_RELEASES_LATEST_URL);
    return true;
  } catch {
    return false;
  }
};
