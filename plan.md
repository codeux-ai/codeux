1. **Create `src/app/runtime-context.ts`:**
   - Define a `RuntimeContext` interface with methods for the mutable state:
     - `get settings(): Settings`
     - `set settings(value: Settings)`
     - `get dashboardSettings(): DashboardSettings | undefined`
     - `set dashboardSettings(value: DashboardSettings)`
     - `get consecutiveFailures(): number`
     - `set consecutiveFailures(value: number)`
     - `get lastStatus(): Partial<DashboardStatus> | null`
     - `set lastStatus(value: Partial<DashboardStatus> | null)`
     - `get dashboardRuntimePort(): number | null`
     - `set dashboardRuntimePort(value: number | null)`
   - Create a class `DefaultRuntimeContext` implementing `RuntimeContext`.
   - Verify creation using `cat src/app/runtime-context.ts`.

2. **Refactor `src/app/dependency-factory.ts`:**
   - Modify the `ServerContext` interface. Add `runtimeContext: RuntimeContext`.
   - Instead of having individual getter/setter closures for settings and state in `ServerContext`, pass `RuntimeContext` through `ServerContext`.
   - Remove these from `ServerContext`: `getSettings`, `getDashboardSettings`, `setDashboardSettings`, `getConsecutiveFailures`, `setConsecutiveFailures`, `updateLastStatus`, `getLastStatus`.
   - Replace them with `runtimeContext: RuntimeContext` in `ServerContext`.

3. **Update Dependency Factories:**
   - Modify `src/app/dependency-factory/core-factory.ts`, `src/app/dependency-factory/sprint-factory.ts`, `src/app/dependency-factory/mcp-factory.ts`, `src/app/dependency-factory/dashboard-factory.ts` to use `context.runtimeContext.getDashboardSettings()` and `context.runtimeContext.lastStatus` instead of the old closures.
   - Run `npx tsc --noEmit` to verify typecheck failures that will be fixed in the next step.

4. **Refactor `src/server/jules-agent-server.ts`:**
   - Add `runtimeContext: RuntimeContext` field to `JulesAgentServer`.
   - Initialize `this.runtimeContext = new DefaultRuntimeContext()`.
   - Remove `settings`, `dashboardSettings`, `consecutiveFailures`, `lastStatus`, `dashboardRuntimePort` fields from the server class.
   - Update `createContext()` to include `runtimeContext: this.runtimeContext` and remove the ad-hoc closures for these states.
   - Update all references to `this.settings`, `this.dashboardSettings`, `this.consecutiveFailures`, `this.lastStatus`, `this.dashboardRuntimePort` to use `this.runtimeContext` in `JulesAgentServer` methods (like `loadSettings`, `syncGitSettingsFromDashboard`, `getEffectiveJulesApiKey`, `getDashboardPort`, etc.).

5. **Verify changes:**
   - Run `npm run typecheck` to verify no type errors exist.

6. **Write tests:**
   - Create `tests/backend/runtime-context.test.ts`.
   - Write tests to verify that the getters and setters for `lastStatus`, `settings`, `dashboardSettings`, `consecutiveFailures`, and `dashboardRuntimePort` correctly update and retrieve state from `DefaultRuntimeContext`.

7. **Run tests:**
   - Run `npm run typecheck`
   - Run `npm run test -- tests/backend/smoke.test.ts`
   - Run `npm run test -- tests/backend/runtime-context.test.ts`

8. **Complete pre commit steps:**
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.

9. **Submit task:**
   - Submit the completed task via `submit` tool to the feature branch.
