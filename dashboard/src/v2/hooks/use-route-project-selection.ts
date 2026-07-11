import { useEffect, useRef, useState } from "preact/hooks";

export interface RouteProjectSelectionState {
  routeProjectReady: boolean;
}

/**
 * Consumes a project-aware deep link once for each route project value.
 *
 * The selected project is shared dashboard state. A mounted Tasks or Live tab
 * must not continuously re-apply an old query parameter whenever another tab
 * or page changes that state, otherwise stale tabs fight over the selection.
 */
export function useRouteProjectSelection(
  routeProjectId: string | null,
  selectedProjectId: string | null,
  selectProject: (projectId: string) => Promise<void>,
): RouteProjectSelectionState {
  const consumedRouteProjectIdRef = useRef<string | null>(null);
  const [pendingRouteProjectId, setPendingRouteProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (!routeProjectId) {
      consumedRouteProjectIdRef.current = null;
      setPendingRouteProjectId(null);
      return;
    }
    if (consumedRouteProjectIdRef.current === routeProjectId) {
      return;
    }

    consumedRouteProjectIdRef.current = routeProjectId;
    if (selectedProjectId === routeProjectId) {
      setPendingRouteProjectId(null);
      return;
    }

    let active = true;
    setPendingRouteProjectId(routeProjectId);
    void selectProject(routeProjectId)
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setPendingRouteProjectId((current) => current === routeProjectId ? null : current);
        }
      });
    return () => {
      active = false;
    };
  }, [routeProjectId, selectProject]);

  const routeProjectReady = !routeProjectId
    || selectedProjectId === routeProjectId
    || (consumedRouteProjectIdRef.current === routeProjectId && pendingRouteProjectId !== routeProjectId);

  return { routeProjectReady };
}
