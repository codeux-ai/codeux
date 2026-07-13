import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { AlertTriangle, ExternalLink, LayoutDashboard, RefreshCw, Save } from "lucide-preact";
import { PageContainer } from "./components/layout/PageContainer.js";
import { PageHeader } from "./components/layout/PageHeader.js";
import { Button } from "./components/ui/Button.js";
import { EmptyState } from "./components/ui/EmptyState.js";
import { ActionFeedbackRegion } from "./components/ui/ActionFeedbackRegion.js";
import { ConfirmDialog } from "./components/ui/ConfirmDialog.js";
import { useConfirmDialog } from "./hooks/use-confirm-dialog.js";
import { useActionFeedback } from "./hooks/use-action-feedback.js";
import { useProjectData } from "./context/project-data.js";
import {
  archiveCustomDashboard,
  createCustomDashboard,
  createCustomDashboardRevision,
  fetchCustomDashboard,
  fetchCustomDashboardDataCatalog,
  fetchCustomDashboardValidationLogs,
  fetchCustomDashboardValidationSession,
  fetchCustomDashboards,
  publishCustomDashboardRevision,
  resumeCustomDashboardRuntime,
  startCustomDashboardValidation,
  updateCustomDashboardDraft,
  type CustomDashboardDataCatalogResponse,
} from "./lib/custom-dashboard-api.js";
import { fetchAutomationCredentials, revokeAutomationCredential, rotateAutomationCredential } from "./lib/automation-credential-api.js";
import {
  createDefaultCustomDashboardDraft,
  hasDraftChanged,
  parseJsonDraft,
  selectLatestRevision,
  stableJsonStringify,
  redactAutomationCredentialMetadata,
} from "./lib/custom-dashboard-view-models.js";
import {
  normalizeCustomDashboardPath,
  readCustomDashboardLocation,
  updateCustomDashboardHistory,
  type CustomDashboardPageMode,
} from "./lib/custom-dashboard-router.js";
import { CustomDashboardList } from "./components/custom-dashboards/CustomDashboardList.js";
import {
  CustomDashboardEditorPanel,
  type CustomDashboardDraftState,
  type CustomDashboardEditorTab,
} from "./components/custom-dashboards/CustomDashboardEditorPanel.js";
import { CustomDashboardValidationPanel } from "./components/custom-dashboards/CustomDashboardValidationPanel.js";
import { CustomDashboardViewer } from "./components/custom-dashboards/CustomDashboardViewer.js";
import type {
  CreateCustomDashboardRevisionInput,
  CustomDashboardDataSourceNodeGraph,
  CustomDashboardFileBundle,
  CustomDashboardJsonObject,
  CustomDashboardManifest,
  CustomDashboardRecord,
  CustomDashboardRouteDefinition,
  CustomDashboardRevisionRecord,
  CustomDashboardValidationSessionRecord,
  UpdateCustomDashboardDraftInput,
} from "./types.js";
import type { AutomationCredentialMetadata } from "../../../src/contracts/automation-credential-types.js";

const terminalValidationStatuses = new Set(["passed", "failed", "cancelled"]);

function dashboardToDraft(dashboard: CustomDashboardRecord): CustomDashboardDraftState {
  return {
    title: dashboard.title,
    description: dashboard.description,
    manifestText: stableJsonStringify(dashboard.manifest),
    fileBundleText: stableJsonStringify(dashboard.fileBundle),
    sourceGraphText: stableJsonStringify(dashboard.sourceNodeGraph),
    routesText: stableJsonStringify(dashboard.routes),
    credentialBindingsText: stableJsonStringify(dashboard.credentialBindings.map(({ slot, credentialId }) => ({ slot, credentialId }))),
    styleguideText: stableJsonStringify(dashboard.styleguide),
  };
}

export const CustomDashboardsPage: FunctionComponent = () => {
  const { selectedProject, loading: projectLoading } = useProjectData();
  const projectId = selectedProject?.id ?? null;
  const initialPageState = useMemo(() => readCustomDashboardLocation(), []);
  const [dashboards, setDashboards] = useState<CustomDashboardRecord[]>([]);
  const [selectedDashboardId, setSelectedDashboardId] = useState<string | null>(initialPageState.dashboardId);
  const [pageMode, setPageMode] = useState<CustomDashboardPageMode>(initialPageState.mode);
  const [routePath, setRoutePath] = useState(initialPageState.routePath);
  const [selectedDashboard, setSelectedDashboard] = useState<CustomDashboardRecord | null>(null);
  const [revisions, setRevisions] = useState<CustomDashboardRevisionRecord[]>([]);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CustomDashboardDataCatalogResponse | null>(null);
  const [credentials, setCredentials] = useState<AutomationCredentialMetadata[]>([]);
  const [credentialsLoading, setCredentialsLoading] = useState(false);
  const [draft, setDraft] = useState<CustomDashboardDraftState | null>(null);
  const [activeTab, setActiveTab] = useState<CustomDashboardEditorTab>("manifest");
  const [selectedFilePath, setSelectedFilePath] = useState("src/dashboard.tsx");
  const [validationSession, setValidationSession] = useState<CustomDashboardValidationSessionRecord | null>(null);
  const [logs, setLogs] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creatingRevision, setCreatingRevision] = useState(false);
  const [validating, setValidating] = useState(false);
  const [refreshingLogs, setRefreshingLogs] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [resuming, setResuming] = useState(false);
  const {
    feedback,
    setError,
    setSuccess,
    clearFeedback,
    clearError,
  } = useActionFeedback();
  const archiveConfirm = useConfirmDialog();
  const credentialConfirm = useConfirmDialog();

  const selectedRevision = useMemo(
    () => revisions.find((revision) => revision.id === selectedRevisionId) ?? null,
    [revisions, selectedRevisionId],
  );
  const dirty = useMemo(() => draft ? hasDraftChanged(selectedDashboard, draft) : false, [draft, selectedDashboard]);

  const navigateWorkspace = useCallback((next: Partial<{ dashboardId: string | null; mode: CustomDashboardPageMode; routePath: string }>, replace = false): void => {
    const location = readCustomDashboardLocation();
    const state = {
      dashboardId: next.dashboardId === undefined ? (selectedDashboardId ?? location.dashboardId) : next.dashboardId,
      mode: next.mode ?? pageMode,
      routePath: normalizeCustomDashboardPath(next.routePath ?? routePath),
    };
    setSelectedDashboardId(state.dashboardId);
    setPageMode(state.mode);
    setRoutePath(state.routePath);
    updateCustomDashboardHistory(state, { replace });
  }, [pageMode, routePath, selectedDashboardId]);

  useEffect(() => {
    const handlePopState = (): void => {
      const state = readCustomDashboardLocation();
      setSelectedDashboardId(state.dashboardId);
      setPageMode(state.mode);
      setRoutePath(state.routePath);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!projectId) {
      setCredentials([]);
      return;
    }
    let cancelled = false;
    setCredentialsLoading(true);
    void fetchAutomationCredentials(projectId)
      .then((items) => { if (!cancelled) setCredentials(items.map(redactAutomationCredentialMetadata)); })
      .catch((error) => { if (!cancelled) setError(error instanceof Error ? error.message : "Failed to load credential metadata."); })
      .finally(() => { if (!cancelled) setCredentialsLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, setError]);

  const loadProjectDashboards = useCallback(async (nextProjectId: string, signal?: AbortSignal): Promise<void> => {
    setLoading(true);
    try {
      const [listResponse, nextCatalog] = await Promise.all([
        fetchCustomDashboards(nextProjectId, signal),
        fetchCustomDashboardDataCatalog(nextProjectId, signal),
      ]);
      if (signal?.aborted) {
        return;
      }
      setDashboards(listResponse.dashboards);
      setCatalog(nextCatalog);
      setSelectedDashboardId((current) => (
        current && listResponse.dashboards.some((dashboard) => dashboard.id === current)
          ? current
          : initialPageState.dashboardId && listResponse.dashboards.some((dashboard) => dashboard.id === initialPageState.dashboardId)
            ? initialPageState.dashboardId
          : listResponse.dashboards[0]?.id ?? null
      ));
      if (listResponse.dashboards.length === 0) {
        setSelectedDashboard(null);
        setRevisions([]);
        setSelectedRevisionId(null);
        setDraft(null);
      }
    } catch (error) {
      if (!signal?.aborted) {
        setError(error instanceof Error ? error.message : "Failed to load custom dashboards.");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [initialPageState.dashboardId, setError]);

  const loadDashboardDetail = useCallback(async (dashboardId: string, signal?: AbortSignal): Promise<void> => {
    try {
      const detail = await fetchCustomDashboard(dashboardId, signal);
      if (signal?.aborted) {
        return;
      }
      setSelectedDashboard(detail.dashboard);
      setDashboards((current) => current.map((dashboard) => dashboard.id === detail.dashboard.id ? detail.dashboard : dashboard));
      setRevisions(detail.revisions);
      const nextRevision = detail.revisions.find((revision) => revision.id === selectedRevisionId)
        ?? selectLatestRevision(detail.revisions);
      setSelectedRevisionId(nextRevision?.id ?? null);
      setDraft(dashboardToDraft(detail.dashboard));
      setSelectedFilePath(detail.dashboard.fileBundle.files[0]?.path ?? "src/dashboard.tsx");
    } catch (error) {
      if (!signal?.aborted) {
        setError(error instanceof Error ? error.message : "Failed to load custom dashboard details.");
      }
    }
  }, [selectedRevisionId, setError]);

  useEffect(() => {
    if (!projectId) {
      setDashboards([]);
      setSelectedDashboardId(null);
      setSelectedDashboard(null);
      setRevisions([]);
      setDraft(null);
      return;
    }
    const controller = new AbortController();
    void loadProjectDashboards(projectId, controller.signal);
    return () => controller.abort();
  }, [loadProjectDashboards, projectId]);

  useEffect(() => {
    if (!selectedDashboardId) {
      return;
    }
    const controller = new AbortController();
    void loadDashboardDetail(selectedDashboardId, controller.signal);
    return () => controller.abort();
  }, [loadDashboardDetail, selectedDashboardId]);

  const refreshSelectedDashboard = useCallback(async (): Promise<void> => {
    if (!selectedDashboardId) {
      return;
    }
    await loadDashboardDetail(selectedDashboardId);
  }, [loadDashboardDetail, selectedDashboardId]);

  const buildDraftInput = useCallback((): UpdateCustomDashboardDraftInput & CreateCustomDashboardRevisionInput => {
    if (!draft) {
      throw new Error("No dashboard draft is selected.");
    }
    const manifest = parseJsonDraft<CustomDashboardManifest>(draft.manifestText, "Manifest");
    if (!manifest.ok) {
      throw new Error(manifest.message);
    }
    const fileBundle = parseJsonDraft<CustomDashboardFileBundle>(draft.fileBundleText, "File bundle");
    if (!fileBundle.ok) {
      throw new Error(fileBundle.message);
    }
    const sourceNodeGraph = parseJsonDraft<CustomDashboardDataSourceNodeGraph>(draft.sourceGraphText, "Source graph");
    if (!sourceNodeGraph.ok) {
      throw new Error(sourceNodeGraph.message);
    }
    const styleguide = parseJsonDraft<CustomDashboardJsonObject>(draft.styleguideText, "Styleguide");
    if (!styleguide.ok) {
      throw new Error(styleguide.message);
    }
    const routes = parseJsonDraft<CustomDashboardRouteDefinition[]>(draft.routesText, "Routes");
    if (!routes.ok || !Array.isArray(routes.value)) {
      throw new Error(routes.ok ? "Routes must be an array." : routes.message);
    }
    const credentialBindings = parseJsonDraft<Array<{ slot: string; credentialId: string }>>(draft.credentialBindingsText, "Credential bindings");
    if (!credentialBindings.ok || !Array.isArray(credentialBindings.value)) {
      throw new Error(credentialBindings.ok ? "Credential bindings must be an array." : credentialBindings.message);
    }
    return {
      title: draft.title.trim() || manifest.value.title || "Untitled Dashboard",
      description: draft.description,
      manifest: manifest.value,
      fileBundle: fileBundle.value,
      sourceNodeGraph: sourceNodeGraph.value,
      routes: routes.value,
      credentialBindings: credentialBindings.value,
      styleguide: styleguide.value,
    };
  }, [draft]);

  const saveDraft = useCallback(async (): Promise<CustomDashboardRecord> => {
    if (!selectedDashboard) {
      throw new Error("No dashboard is selected.");
    }
    const input = buildDraftInput();
    const updated = await updateCustomDashboardDraft(selectedDashboard.id, input);
    setSelectedDashboard(updated);
    setDashboards((current) => current.map((dashboard) => dashboard.id === updated.id ? updated : dashboard));
    setDraft(dashboardToDraft(updated));
    return updated;
  }, [buildDraftInput, selectedDashboard]);

  const handleSaveDraft = async (): Promise<void> => {
    setSaving(true);
    clearFeedback();
    try {
      await saveDraft();
      setSuccess("Custom dashboard draft saved.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to save custom dashboard.");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateDashboard = async (): Promise<void> => {
    if (!projectId) {
      return;
    }
    setCreating(true);
    clearFeedback();
    try {
      const created = await createCustomDashboard(projectId, createDefaultCustomDashboardDraft());
      setDashboards((current) => [created, ...current]);
      setSelectedDashboardId(created.id);
      setSuccess("Custom dashboard created.");
      await loadProjectDashboards(projectId);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to create custom dashboard.");
    } finally {
      setCreating(false);
    }
  };

  const handleCreateRevision = async (): Promise<void> => {
    if (!selectedDashboard) {
      return;
    }
    setCreatingRevision(true);
    clearFeedback();
    try {
      const input = buildDraftInput();
      if (dirty) {
        await saveDraft();
      }
      const revision = await createCustomDashboardRevision(selectedDashboard.id, input);
      setRevisions((current) => [revision, ...current.filter((item) => item.id !== revision.id)]);
      setSelectedRevisionId(revision.id);
      setValidationSession(null);
      setLogs("");
      setSuccess(`Revision ${revision.revisionNumber} created.`);
      await refreshSelectedDashboard();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to create dashboard revision.");
    } finally {
      setCreatingRevision(false);
    }
  };

  const refreshLogs = useCallback(async (sessionId: string): Promise<void> => {
    setRefreshingLogs(true);
    try {
      const response = await fetchCustomDashboardValidationLogs(sessionId, 300);
      setLogs(response.logs);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to load validation logs.");
    } finally {
      setRefreshingLogs(false);
    }
  }, [setError]);

  const handleStartValidation = async (): Promise<void> => {
    if (!projectId || !selectedDashboard || !selectedRevision) {
      return;
    }
    setValidating(true);
    setLogs("");
    clearFeedback();
    try {
      const session = await startCustomDashboardValidation(selectedDashboard.id, selectedRevision.id, projectId);
      setValidationSession(session);
      await refreshLogs(session.id);
      setSuccess(`Validation ${session.status}.`);
      if (terminalValidationStatuses.has(session.status)) {
        await refreshSelectedDashboard();
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to start validation.");
    } finally {
      setValidating(false);
    }
  };

  useEffect(() => {
    if (!validationSession || terminalValidationStatuses.has(validationSession.status)) {
      return;
    }
    let cancelled = false;
    const interval = window.setInterval(() => {
      void fetchCustomDashboardValidationSession(validationSession.id)
        .then((session) => {
          if (cancelled) {
            return;
          }
          setValidationSession(session);
          void refreshLogs(session.id);
          if (terminalValidationStatuses.has(session.status)) {
            void refreshSelectedDashboard();
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setError(error instanceof Error ? error.message : "Failed to poll validation status.");
          }
        });
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [refreshLogs, refreshSelectedDashboard, setError, validationSession]);

  const handleRefreshLogs = async (): Promise<void> => {
    if (validationSession) {
      await refreshLogs(validationSession.id);
    }
  };

  const handlePublish = async (): Promise<void> => {
    if (!selectedDashboard || !selectedRevision) {
      return;
    }
    setPublishing(true);
    clearFeedback();
    try {
      const validationSessionId = validationSession?.revisionId === selectedRevision.id ? validationSession.id : undefined;
      const published = await publishCustomDashboardRevision(
        selectedDashboard.id,
        selectedRevision.id,
        validationSessionId,
        selectedDashboard.runtimeState.status === "halted" ? selectedDashboard.publishedRevisionId : undefined,
      );
      setSelectedDashboard(published);
      setDashboards((current) => current.map((dashboard) => dashboard.id === published.id ? published : dashboard));
      setSuccess("Custom dashboard revision published.");
      await refreshSelectedDashboard();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to publish revision.");
    } finally {
      setPublishing(false);
    }
  };

  const handleResume = async (): Promise<void> => {
    if (!selectedDashboard?.publishedRevisionId) return;
    setResuming(true);
    clearFeedback();
    try {
      const resumed = await resumeCustomDashboardRuntime(
        selectedDashboard.id,
        selectedDashboard.publishedRevisionId,
        validationSession?.revisionId === selectedDashboard.publishedRevisionId ? validationSession.id : undefined,
      );
      setSelectedDashboard(resumed);
      setDashboards((current) => current.map((dashboard) => dashboard.id === resumed.id ? resumed : dashboard));
      setSuccess("Validated custom dashboard runtime resumed.");
      await refreshSelectedDashboard();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to resume the custom dashboard runtime.");
    } finally {
      setResuming(false);
    }
  };

  const handleRotateCredential = async (credentialId: string, value: string): Promise<void> => {
    if (!projectId || !value) return;
    await rotateAutomationCredential(projectId, credentialId, value);
    setCredentials((await fetchAutomationCredentials(projectId)).map(redactAutomationCredentialMetadata));
    setSuccess("Credential rotated. Secret material was not retained by the dashboard.");
  };

  const handleRevokeCredential = async (credentialId: string): Promise<boolean> => {
    if (!projectId) return false;
    const metadata = credentials.find((credential) => credential.id === credentialId);
    const confirmed = await credentialConfirm.requestConfirm({
      title: "Revoke credential?",
      body: `Revoke ${metadata?.name ?? "this credential"}? Published sources using it will stop until another eligible credential is bound and published.`,
      confirmLabel: "Revoke",
      destructive: true,
      tone: "danger",
    });
    if (!confirmed) return false;
    await revokeAutomationCredential(projectId, credentialId);
    setCredentials((await fetchAutomationCredentials(projectId)).map(redactAutomationCredentialMetadata));
    setSuccess("Credential revoked.");
    return true;
  };

  const handleArchive = async (): Promise<void> => {
    if (!selectedDashboard) {
      return;
    }
    const confirmed = await archiveConfirm.requestConfirm({
      title: "Archive custom dashboard?",
      body: "Archiving clears the active publication while preserving revision and validation history.",
      confirmLabel: "Archive",
      destructive: true,
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    setArchiving(true);
    clearFeedback();
    try {
      const archived = await archiveCustomDashboard(selectedDashboard.id);
      setSelectedDashboard(archived);
      setDashboards((current) => current.map((dashboard) => dashboard.id === archived.id ? archived : dashboard));
      setDraft(dashboardToDraft(archived));
      setSuccess("Custom dashboard archived.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to archive custom dashboard.");
    } finally {
      setArchiving(false);
    }
  };

  const noProject = !projectLoading && !projectId;
  const showEmpty = !loading && projectId && dashboards.length === 0;

  return (
    <PageContainer aria-label="Custom dashboards" padding="section" className="gap-6">
      <PageHeader
        icon={LayoutDashboard}
        eyebrow="Custom Dashboards"
        title="Dashboard Workspace"
        subtitle="Manage generated dashboard drafts, validate immutable revisions in detached preview sessions, and publish only validated bundles."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={RefreshCw} onClick={() => projectId && void loadProjectDashboards(projectId)} disabled={!projectId} pending={loading}>
              Refresh
            </Button>
            <Button
              icon={ExternalLink}
              onClick={() => navigateWorkspace({ mode: "viewer" })}
              disabled={!selectedDashboard}
              disabledReason="Select a dashboard with a published validated revision to open it."
            >
              Open Published
            </Button>
            <Button icon={Save} variant="signal" onClick={() => void handleSaveDraft()} disabled={!selectedDashboard || !dirty || selectedDashboard.status === "archived"} pending={saving}>
              Save Draft
            </Button>
          </div>
        )}
      />

      <ActionFeedbackRegion
        status={feedback.status}
        message={feedback.message}
        onDismiss={clearFeedback}
        clearError={clearError}
        autoDismiss={feedback.autoDismiss}
        retryAction={feedback.retryAction}
        retryLabel={feedback.retryLabel}
        retryPending={feedback.retryPending}
      />

      {noProject ? (
        <EmptyState
          icon={<LayoutDashboard className="h-8 w-8" aria-hidden="true" />}
          title="Select a project to manage custom dashboards."
          description="Custom dashboards are scoped to the active project and use that project's persisted data catalog."
        />
      ) : null}

      {showEmpty ? (
        <EmptyState
          icon={<LayoutDashboard className="h-8 w-8" aria-hidden="true" />}
          title="No custom dashboards yet."
          description="Create a draft to edit the generated manifest, file bundle, source graph, and validation workflow."
          primaryAction={<Button icon={LayoutDashboard} variant="signal" pending={creating} onClick={() => void handleCreateDashboard()}>Create Dashboard</Button>}
        />
      ) : null}

      {loading && dashboards.length === 0 && projectId ? (
        <div className="rounded-[1.4rem] border border-black/[0.08] bg-white/70 p-8 text-sm font-semibold text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-400">
          Loading custom dashboards...
        </div>
      ) : null}

      {projectId && dashboards.length > 0 && selectedDashboard && draft ? (
        <div className={`grid min-w-0 gap-4 ${
          pageMode === "viewer"
            ? "xl:grid-cols-[minmax(14rem,0.32fr)_minmax(0,1fr)]"
            : "xl:grid-cols-[minmax(14rem,0.42fr)_minmax(0,1fr)_minmax(18rem,0.5fr)]"
        }`}>
          <CustomDashboardList
            dashboards={dashboards}
            selectedDashboardId={selectedDashboardId}
            onSelect={(dashboardId) => {
              navigateWorkspace({ dashboardId, mode: "editor", routePath: "/" });
              setValidationSession(null);
              setLogs("");
            }}
            onCreate={() => void handleCreateDashboard()}
            creating={creating}
          />
          {pageMode === "viewer" ? (
            <CustomDashboardViewer
              dashboard={selectedDashboard}
              revisions={revisions}
              onRefresh={() => void refreshSelectedDashboard()}
              onReturnToEditor={() => navigateWorkspace({ mode: "editor" })}
              refreshing={loading}
              routePath={routePath}
              onRouteChange={(path, options) => {
                const normalized = normalizeCustomDashboardPath(path);
                if (normalized !== routePath) navigateWorkspace({ mode: "viewer", routePath: normalized }, options?.replace);
              }}
              onResume={() => void handleResume()}
              resuming={resuming}
            />
          ) : (
            <>
              <CustomDashboardEditorPanel
                draft={draft}
                onDraftChange={setDraft}
                activeTab={activeTab}
                onActiveTabChange={setActiveTab}
                selectedFilePath={selectedFilePath}
                onSelectedFilePathChange={setSelectedFilePath}
                catalog={catalog}
                credentials={credentials}
                credentialsLoading={credentialsLoading}
                onRotateCredential={handleRotateCredential}
                onRevokeCredential={handleRevokeCredential}
              />
              <CustomDashboardValidationPanel
                dashboard={selectedDashboard}
                revisions={revisions}
                selectedRevision={selectedRevision}
                selectedRevisionId={selectedRevisionId}
                onSelectedRevisionIdChange={(revisionId) => {
                  setSelectedRevisionId(revisionId);
                  setValidationSession(null);
                  setLogs("");
                }}
                validationSession={validationSession}
                logs={logs}
                creatingRevision={creatingRevision}
                validating={validating}
                refreshingLogs={refreshingLogs}
                publishing={publishing}
                archiving={archiving}
                onCreateRevision={() => void handleCreateRevision()}
                onStartValidation={() => void handleStartValidation()}
                onRefreshLogs={() => void handleRefreshLogs()}
                onPublish={() => void handlePublish()}
                onArchive={() => void handleArchive()}
              />
            </>
          )}
        </div>
      ) : null}

      {!loading && projectId && dashboards.length > 0 && !selectedDashboard ? (
        <div className="flex items-center gap-2 rounded-[1rem] border border-status-red/20 bg-status-red/[0.06] p-4 text-sm font-semibold text-status-red">
          <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
          Custom dashboard details could not be loaded.
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={archiveConfirm.isOpen}
        options={archiveConfirm.options}
        onConfirm={archiveConfirm.handleConfirm}
        onCancel={archiveConfirm.handleCancel}
      />
      <ConfirmDialog
        isOpen={credentialConfirm.isOpen}
        options={credentialConfirm.options}
        onConfirm={credentialConfirm.handleConfirm}
        onCancel={credentialConfirm.handleCancel}
      />
    </PageContainer>
  );
};
