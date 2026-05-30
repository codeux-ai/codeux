import { useEffect, useState } from "preact/hooks";

const readIsDark = (): boolean => {
  if (typeof document === "undefined") {
    return true;
  }
  return document.documentElement.classList.contains("dark");
};

/**
 * Tracks whether the app is currently in dark mode by observing the `dark`
 * class toggled on the document root by the appearance system.
 */
export const useIsDark = (): boolean => {
  const [isDark, setIsDark] = useState(readIsDark);

  useEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
      return;
    }
    const observer = new MutationObserver(() => setIsDark(readIsDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
};
