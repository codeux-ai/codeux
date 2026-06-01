interface NavigationBlockerRegistration {
  shouldBlock: () => boolean;
  confirmNavigation: (retry: () => void) => boolean;
}

type UnregisterNavigationBlocker = () => void;

type HistoryMutation = (data: unknown, unused: string, url?: string | URL | null) => void;

const DEFAULT_CONFIRM_MESSAGE = "You have unsaved changes. Leave this page?";

const blockers = new Map<symbol, NavigationBlockerRegistration>();

let interceptorsInstalled = false;
let restoringNavigation = false;
let currentHref = typeof window !== "undefined" ? window.location.href : "";

let originalPushState: HistoryMutation | null = null;
let originalReplaceState: HistoryMutation | null = null;
let clickListener: ((event: MouseEvent) => void) | null = null;
let popstateListener: ((event: PopStateEvent) => void) | null = null;

const withRestoreBypass = (run: () => void): void => {
  restoringNavigation = true;
  try {
    run();
  } finally {
    restoringNavigation = false;
  }
};

const getBlockingRegistration = (): NavigationBlockerRegistration | null => {
  for (const registration of blockers.values()) {
    if (registration.shouldBlock()) {
      return registration;
    }
  }
  return null;
};

const shouldAllowNavigation = (retry: () => void): boolean => {
  if (restoringNavigation) {
    return true;
  }
  const registration = getBlockingRegistration();
  if (!registration) {
    return true;
  }
  return registration.confirmNavigation(retry);
};

const resolveHref = (url?: string | URL | null): string => {
  if (!url) {
    return window.location.href;
  }
  return new URL(String(url), window.location.href).href;
};

const installInterceptors = (): void => {
  if (interceptorsInstalled || typeof window === "undefined") {
    return;
  }

  originalPushState = window.history.pushState.bind(window.history) as HistoryMutation;
  originalReplaceState = window.history.replaceState.bind(window.history) as HistoryMutation;

  window.history.pushState = ((data: unknown, unused: string, url?: string | URL | null): void => {
    const nextHref = resolveHref(url);
    if (nextHref !== window.location.href && !shouldAllowNavigation(() => {
      withRestoreBypass(() => {
        window.history.pushState(data, unused, url);
      });
    })) {
      return;
    }
    originalPushState?.(data, unused, url);
    currentHref = nextHref;
  }) as HistoryMutation;

  window.history.replaceState = ((data: unknown, unused: string, url?: string | URL | null): void => {
    const nextHref = resolveHref(url);
    if (nextHref !== window.location.href && !shouldAllowNavigation(() => {
      withRestoreBypass(() => {
        window.history.replaceState(data, unused, url);
      });
    })) {
      return;
    }
    originalReplaceState?.(data, unused, url);
    currentHref = nextHref;
  }) as HistoryMutation;

  clickListener = (event: MouseEvent): void => {
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) {
      return;
    }

    const target = event.target as Element | null;
    const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) {
      return;
    }

    const anchorUrl = new URL(anchor.href, window.location.href);
    if (anchorUrl.origin !== window.location.origin || anchorUrl.href === window.location.href) {
      return;
    }

    if (!shouldAllowNavigation(() => {
      withRestoreBypass(() => {
        window.location.href = anchorUrl.href;
      });
    })) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  popstateListener = (): void => {
    const nextHref = window.location.href;
    if (nextHref === currentHref) {
      return;
    }

    if (!shouldAllowNavigation(() => {
      withRestoreBypass(() => {
        window.location.href = nextHref;
      });
    })) {
      withRestoreBypass(() => {
        originalPushState?.(window.history.state, document.title, currentHref);
      });
      return;
    }

    currentHref = nextHref;
  };

  window.addEventListener("click", clickListener, true);
  window.addEventListener("popstate", popstateListener);
  interceptorsInstalled = true;
};

const uninstallInterceptors = (): void => {
  if (!interceptorsInstalled || typeof window === "undefined") {
    return;
  }

  if (originalPushState) {
    window.history.pushState = originalPushState as History["pushState"];
  }
  if (originalReplaceState) {
    window.history.replaceState = originalReplaceState as History["replaceState"];
  }

  if (clickListener) {
    window.removeEventListener("click", clickListener, true);
  }
  if (popstateListener) {
    window.removeEventListener("popstate", popstateListener);
  }

  originalPushState = null;
  originalReplaceState = null;
  clickListener = null;
  popstateListener = null;
  interceptorsInstalled = false;
};

export const registerNavigationBlocker = ({
  shouldBlock,
  confirmNavigation,
}: {
  shouldBlock: () => boolean;
  confirmNavigation?: (retry: () => void) => boolean;
}): UnregisterNavigationBlocker => {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  installInterceptors();

  const key = Symbol("navigation-blocker");
  blockers.set(key, {
    shouldBlock,
    confirmNavigation: confirmNavigation ?? ((retry) => window.confirm(DEFAULT_CONFIRM_MESSAGE)),
  });

  return () => {
    blockers.delete(key);
    if (blockers.size === 0) {
      uninstallInterceptors();
    }
  };
};

export const getNavigationBlockerCount = (): number => blockers.size;
