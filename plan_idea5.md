Wait, in `use-dashboard-runtime-data.ts`, `inferredProjectId` is set via `setInferredProjectId(newId)` inside `fetchResourceWithProjectExtraction` which is called *during* the fetch (an async operation).
Is this a "render-phase state write"? No, it happens asynchronously in a promise callback!
However, `inferredProjectId` is updated in a state when `projectIdHint` changes or data is fetched, so that it can be passed into `useRealtimeResource({ realtime: { scopes: [...] } })`.
Is there a problem with this?
"The prompt explicitly requested edits to dashboard/src/hooks/use-dashboard-runtime-data.ts and dashboard/src/v2/context/project-data.tsx (likely to clean up old workarounds related to this bug)"

Let's look at `dashboard/src/v2/context/project-data.tsx`.
```typescript
  const selectProject = async (projectId: string): Promise<void> => {
    updateDataLocally((curr) => ({ ...curr, selectedProjectId: projectId }));
    const nextProjectId = await selectProjectRequest(projectId);
    updateDataLocally((curr) => ({ ...curr, selectedProjectId: nextProjectId }));
  };
```
Is this the workaround?
What else is in `use-dashboard-runtime-data.ts`?
Wait! In `use-dashboard-runtime-data.ts`, the `projectIdHint` is passed:
```typescript
  const [inferredProjectId, setInferredProjectId] = useState<string | null>(projectIdHint);
```
But `useState` initialization only happens once! So if `projectIdHint` changes, `inferredProjectId` DOES NOT CHANGE until `fetchResourceWithProjectExtraction` resolves!
This means if you switch projects, `useRealtimeResource` is still listening to the OLD `inferredProjectId` socket until the new fetch finishes!
To fix this, we should do:
```typescript
  const [inferredProjectIdState, setInferredProjectId] = useState<string | null>(projectIdHint);

  // If projectIdHint changes from the parent, immediately update inferred.
  const inferredProjectId = projectIdHint || inferredProjectIdState;
```
Wait, if we do:
```typescript
  const [inferredProjectId, setInferredProjectId] = useState<string | null>(projectIdHint);

  if (projectIdHint && projectIdHint !== inferredProjectId) {
    setInferredProjectId(projectIdHint);
  }
```
If this was in the code previously, it would be a render-phase update! But it's not.
Wait! Is it in `use-dashboard-runtime-data.ts`? No, it's not.
Let's see what *is* the issue.
"ensure initial-data resets happen without stale UI flashes."
Wait, `use-dashboard-runtime-data.ts` does:
```typescript
  const {
    data: finalSnapshot,
    // ...
  } = useRealtimeResource<ProjectLiveDashboardSnapshot>({
    initialData: EMPTY_LIVE_SNAPSHOT,
    // ...
```
If `initialData` is always `EMPTY_LIVE_SNAPSHOT` (a constant reference), then `initialData !== prevInitialDataRef.current` will NEVER be true! So changing `projectIdHint` will NOT cause a reset to `EMPTY_LIVE_SNAPSHOT`!

Ah!!!
If you change projects in the UI, `projectIdHint` changes. But `initialData: EMPTY_LIVE_SNAPSHOT` stays the same constant reference!
So `useRealtimeResource` NEVER detects an `initialData` change. It only re-fetches because `fetchResource` (which depends on `projectIdHint`) changes.
But because `initialData` didn't change, `useRealtimeResource` just shows the OLD project's data (the stale UI flash!) while the new fetch is happening!

To fix this, `use-dashboard-runtime-data.ts` should pass a NEW `initialData` reference when the project changes, or we should use `isRecovering` to hide the UI? No, the requirement says: "ensuring initial-data resets happen without stale UI flashes."
In `use-dashboard-runtime-data.ts`:
```typescript
  const {
    data: finalSnapshot,
    // ...
  } = useRealtimeResource<ProjectLiveDashboardSnapshot>({
    // By passing a new object whenever projectIdHint changes, we trigger the initialData reset!
    initialData: useMemo(() => ({ ...EMPTY_LIVE_SNAPSHOT, projectId: projectIdHint }), [projectIdHint]),
    fetchResource: fetchResourceWithProjectExtraction,
```
Wait, if we change `initialData` to a new object, `useRealtimeResource` will immediately swap `data` to `initialData` (which is empty) while it fetches! This prevents the stale UI flash of showing Project A's tasks while Project B is loading!
This is EXACTLY why `use-dashboard-runtime-data.ts` and `project-data.tsx` need updates!

Let's check `project-data.tsx`.
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
Does `project-data.tsx` have a "stale flash" issue?
It manages the global project list. `initialData: EMPTY_PROJECTS`. The `fetchResource` has no dependencies (`[]`). So it never changes. So `project-data.tsx` doesn't suffer from this, BUT wait!
What if we pass a new `initialData`?
Wait, if `fetchResource` doesn't change, `initialData` doesn't change, what's the issue in `project-data.tsx`?
Let's see if there is any render-phase update in `project-data.tsx` or `use-dashboard-runtime-data.ts`?
I searched for `isEqual` and found them. Let's grep for `useState` in both.
