Ah! `useState` is imported but NOT USED in `project-data.tsx`?
Let's check the grep output for `project-data.tsx`:
`import { useCallback, useContext, useMemo, useState } from "preact/hooks";`
If it's not used, it was just left there. But is there a workaround in `project-data.tsx` related to `initialData`?

Wait!
"The prompt explicitly requested edits to dashboard/src/hooks/use-dashboard-runtime-data.ts and dashboard/src/v2/context/project-data.tsx (likely to clean up old workarounds related to this bug)"

Let's read the exact issue prompt:
"Make `useRealtimeResource` safe and predictable by removing render-phase state writes, preserving abort behavior across refetches, and ensuring initial-data resets happen without stale UI flashes."

What if the workarounds ARE in those files?
In `use-dashboard-runtime-data.ts`:
Wait! If `projectIdHint` changes, it doesn't trigger an `initialData` reset because `EMPTY_LIVE_SNAPSHOT` is a constant. We SHOULD update `initialData` to be a newly created empty object when `projectIdHint` changes, so that the new `useRealtimeResource` logic kicks in and immediately resets the data, avoiding a stale flash!
```typescript
  const emptySnapshot = useMemo(() => ({
    ...EMPTY_LIVE_SNAPSHOT,
    projectId: projectIdHint,
  }), [projectIdHint]);

  const {
    data: finalSnapshot,
    // ...
  } = useRealtimeResource<ProjectLiveDashboardSnapshot>({
    initialData: emptySnapshot,
    // ...
```
And also fix the `inferredProjectId` state:
```typescript
  const [inferredProjectId, setInferredProjectId] = useState<string | null>(projectIdHint);

  // If projectIdHint changes, inferredProjectId should also immediately change for the scopes!
  const activeProjectId = projectIdHint || inferredProjectId;
```

Let's check `project-data.tsx`. Is there an `initialData` issue?
In `project-data.tsx`:
```typescript
  const {
    data,
    loading,
    error,
    refetch,
    updateDataLocally,
  } = useRealtimeResource<ProjectsResponse>({
    initialData: EMPTY_PROJECTS,
    fetchResource,
    isEqual,
```
Is `project-data.tsx` suffering from anything?
Wait, if you logout and login as a different user, does the project data flash?
Usually not relevant since `fetchResource` for projects has no dependencies.
But wait! If there's a workaround in `project-data.tsx`?
Let's look at `project-data.tsx` again.
