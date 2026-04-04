import { useState, useCallback } from "preact/hooks";

export interface ConfirmDialogOptions {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export function useConfirmDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmDialogOptions | null>(null);

  const [resolvePromise, setResolvePromise] = useState<((value: boolean) => void) | null>(null);

  const requestConfirm = useCallback((opts: ConfirmDialogOptions) => {
    setOptions(opts);
    setIsOpen(true);
    return new Promise<boolean>((resolve) => {
      setResolvePromise(() => resolve);
    });
  }, []);

  const handleConfirm = useCallback(() => {
    if (resolvePromise) resolvePromise(true);
    setIsOpen(false);
  }, [resolvePromise]);

  const handleCancel = useCallback(() => {
    if (resolvePromise) resolvePromise(false);
    setIsOpen(false);
  }, [resolvePromise]);

  return {
    isOpen,
    options,
    requestConfirm,
    handleConfirm,
    handleCancel
  };
}
