import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { AlertTriangle, ExternalLink, LayoutDashboard, RefreshCw, Save } from "lucide-preact";
import { PageContainer } from "./components/layout/PageContainer.js";
import { PageHeader } from "./components/layout/PageHeader.js";
import { Button } from "./components/ui/Button.js";
import { EmptyState } from "./components/ui/EmptyState.js";
import { ActionFeedbackRegion } from "./components/ui/ActionFeedbackRegion.js";
import { ConfirmDialog } from "./components/ui/ConfirmDialog.js";
import { UnsavedChangesModal } from "./components/ui/UnsavedChangesModal.js";
import { useConfirmDialog } from "./hooks/use-confirm-dialog.js";
import { useActionFeedback } from "./hooks/use-action-feedback.js";
import { useUnsavedChangesGuard } from "./hooks/useUnsavedChangesGuard.js";
import { useProjectData } from "./context/project-data.js";
import {
  archiveCustomDashboard,
  bindCustomDashboardCredential,
  createCustomDashboard,
  createCustomDashboardRevision,
  fetchCustomDashboard,
  fetchCustomDashboardCredentialBindings,
  fetchCustomDashboardDataCatalog,
  fetchCustomDashboardValidationLogs,
  fetchCustomDashboardValidationSession,
  fetchCustomDashboards,
  publishCustomDashboardRevision,
  startCustomDashboardValidation,
  unbindCustomDashboardCredential,
  updateCustomDashboardDraft,
  CustomDashboardCredentialBindingApiError,
  type CustomDashboardCredentialBindingReview,
  type CustomDashboardDataCatalogResponse,
} from "./lib/custom-dashboard-api.js";
import {
  fetchAutomationCredentials,
  fetchCredentialHealth,
} from "./lib/automation-credential-api.js";
import {
  createDefaultCustomDashboardDraft,
  hasDraftChanged,
  parseJsonDraft,
  getRevisionValidationLabel,
  selectLatestRevision,
  stableJsonStringify,
} from "./lib/custom-dashboard-view-models.js";
import { CustomDashboardList } from "./components/custom-dashboards/CustomDashboardList.js";
import {
  CustomDashboardEditorPanel,
  type CustomDashboardDraftErrors,
  type CustomDashboardDraftState,
  type CustomDashboardEditorFocusRequest,
  type CustomDashboardEditorTab,
  type CustomDashboardJsonDraftField,
} from "./components/custom-dashboards/CustomDashboardEditorPanel.js";
import { CustomDashboardValidationPanel } from "./components/custom-dashboards/CustomDashboardValidationPanel.js";
import { CustomDashboardCredentialSlotsPanel } from "./components/custom-dashboards/CustomDashboardCredentialSlotsPanel.js";
import { CustomDashboardViewer } from "./components/custom-dashboards/CustomDashboardViewer.js";
import type {
  AutomationCredentialMetadata,
  CredentialBackendHealth,
} from "../../../src/contracts/automation-credential-types.js";
import type {
  CreateCustomDashboardRevisionInput,
  CustomDashboardDataSourceNodeGraph,
  CustomDashboardFileBundle,
  CustomDashboardJsonObject,
  CustomDashboardManifest,
  CustomDashboardRecord,
  CustomDashboardRevisionRecord,
  CustomDashboardValidationSessionRecord,
  UpdateCustomDashboardDraftInput,
} from "./types.js";
import { useDashboardI18n } from "./i18n/context.js";
import { customDashboardMessages } from "./i18n/messages/custom-dashboards.js";

const terminalValidationStatuses = new Set(["passed", "failed", "cancelled"]);

type CustomDashboardPageMode = "editor" | "viewer";
type ValidationPollingState = "idle" | "active" | "stale" | "recovering" | "failed";

interface PendingWorkspaceTransition {
  key: string;
  run: () => void | Promise<void>;
}

class DraftValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftValidationError";
  }
}

const JSON_FIELD_TABS: Record<CustomDashboardJsonDraftField, CustomDashboardEditorTab> = {
  manifestText: "manifest",
  fileBundleText: "files",
  sourceGraphText: "sources",
  styleguideText: "styleguide",
};

function getInitialDashboardPageState(): { dashboardId: string | null; mode: CustomDashboardPageMode } {
  if (typeof window === "undefined") {
    return { dashboardId: null, mode: "editor" };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    dashboardId: params.get("dashboard"),
    mode: params.get("mode") === "viewer" ? "viewer" : "editor",
  };
}

function dashboardToDraft(dashboard: CustomDashboardRecord): CustomDashboardDraftState {
  return {
    title: dashboard.title,
    description: dashboard.description,
    manifestText: stableJsonStringify(dashboard.manifest),
    fileBundleText: stableJsonStringify(dashboard.fileBundle),
    sourceGraphText: stableJsonStringify(dashboard.sourceNodeGraph),
    styleguideText: stableJsonStringify(dashboard.styleguide),
  };
}

export const CustomDashboardsPage: FunctionComponent = () => {
  const { locale, translate } = useDashboardI18n();
  const { selectedProject, loading: projectLoading, selectProject } = useProjectData();
  const contextProjectId = selectedProject?.id ?? null;
  const [projectId, setProjectId] = useState<string | null>(contextProjectId);
  const initialPageState = useMemo(() => getInitialDashboardPageState(), []);
  const [dashboards, setDashboards] = useState<CustomDashboardRecord[]>([]);
  const [selectedDashboardId, setSelectedDashboardId] = useState<string | null>(initialPageState.dashboardId);
  const [pageMode, setPageMode] = useState<CustomDashboardPageMode>(initialPageState.mode);
  const [selectedDashboard, setSelectedDashboard] = useState<CustomDashboardRecord | null>(null);
  const [revisions, setRevisions] = useState<CustomDashboardRevisionRecord[]>([]);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CustomDashboardDataCatalogResponse | null>(null);
  const [credentialReview, setCredentialReview] = useState<CustomDashboardCredentialBindingReview | null>(null);
  const [credentialMetadata, setCredentialMetadata] = useState<AutomationCredentialMetadata[]>([]);
  const [credentialHealth, setCredentialHealth] = useState<CredentialBackendHealth | null>(null);
  const [credentialLoading, setCredentialLoading] = useState(false);
  const [credentialLoadError, setCredentialLoadError] = useState<string | null>(null);
  const [savingCredentialSlotId, setSavingCredentialSlotId] = useState<string | null>(null);
  const [credentialSlotErrors, setCredentialSlotErrors] = useState<Record<string, string>>({});
  const [credentialSlotAnnouncements, setCredentialSlotAnnouncements] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<CustomDashboardDraftState | null>(null);
  const [draftErrors, setDraftErrors] = useState<CustomDashboardDraftErrors>({});
  const [editorFocusRequest, setEditorFocusRequest] = useState<CustomDashboardEditorFocusRequest | null>(null);
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
  const [pollingState, setPollingState] = useState<ValidationPollingState>("idle");
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [validationAnnouncement, setValidationAnnouncement] = useState("");
  const [retryingPoll, setRetryingPoll] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const {
    feedback,
    setError,
    setSuccess,
    clearFeedback,
    clearError,
  } = useActionFeedback();
  const archiveConfirm = useConfirmDialog();
  const [pendingTransition, setPendingTransition] = useState<PendingWorkspaceTransition | null>(null);
  const [discardingTransition, setDiscardingTransition] = useState(false);
  const bindingActionControllerRef = useRef<AbortController | null>(null);
  const credentialLoadControllerRef = useRef<AbortController | null>(null);
  const dirtyRef = useRef(false);
  const validationIdentityRef = useRef(0);
  const validationStatusAnnouncementRef = useRef("");
  const pollingAnnouncementRef = useRef<ValidationPollingState>("idle");
  const retryPollRef = useRef<(() => Promise<void>) | null>(null);
  const selectedRevisionIdRef = useRef<string | null>(selectedRevisionId);

  const selectedRevision = useMemo(
    () => revisions.find((revision) => revision.id === selectedRevisionId) ?? null,
    [revisions, selectedRevisionId],
  );
  const dirty = useMemo(() => draft ? hasDraftChanged(selectedDashboard, draft) : false, [draft, selectedDashboard]);
  const hasCredentialSlots = Boolean(selectedDashboard?.manifest.credentialSlots?.length);
  dirtyRef.current = dirty;
  selectedRevisionIdRef.current = selectedRevisionId;
  useUnsavedChangesGuard(dirty, { message: translate(customDashboardMessages, "unsavedNavigationWarning") });

  const clearValidationPolling = useCallback((): void => {
    validationIdentityRef.current += 1;
    retryPollRef.current = null;
    setValidationSession(null);
    setPollingState("idle");
    setPollingError(null);
    setRetryingPoll(false);
    setValidationAnnouncement("");
    validationStatusAnnouncementRef.current = "";
  }, []);

  const resetValidationWorkspace = useCallback((): void => {
    clearValidationPolling();
    setLogs("");
    setRefreshingLogs(false);
  }, [clearValidationPolling]);

  const announceValidationStatus = useCallback((session: CustomDashboardValidationSessionRecord): void => {
    const announcementKey = `${session.id}:${session.status}`;
    if (validationStatusAnnouncementRef.current === announcementKey) {
      return;
    }
    validationStatusAnnouncementRef.current = announcementKey;
    setValidationAnnouncement(translate(customDashboardMessages, "validationStatus", {
      status: getRevisionValidationLabel(session.status, locale),
    }));
  }, [locale, translate]);

  const getDraftFieldError = useCallback((field: CustomDashboardJsonDraftField, valueOverride?: string): string | null => {
    if (!draft) {
      return translate(customDashboardMessages, "noDraftSelected");
    }
    const fieldConfig: Record<CustomDashboardJsonDraftField, { value: string; label: string }> = {
      manifestText: { value: draft.manifestText, label: translate(customDashboardMessages, "manifestFieldName") },
      fileBundleText: { value: draft.fileBundleText, label: translate(customDashboardMessages, "fileBundleFieldName") },
      sourceGraphText: { value: draft.sourceGraphText, label: translate(customDashboardMessages, "sourceGraphFieldName") },
      styleguideText: { value: draft.styleguideText, label: translate(customDashboardMessages, "styleguideFieldName") },
    };
    const config = fieldConfig[field];
    const result = parseJsonDraft<unknown>(valueOverride ?? config.value, config.label, locale);
    return result.ok ? null : result.message;
  }, [draft, locale, translate]);

  const validateDraftField = useCallback((field: CustomDashboardJsonDraftField, valueOverride?: string): boolean => {
    const error = getDraftFieldError(field, valueOverride);
    setDraftErrors((current) => {
      if (error) {
        return { ...current, [field]: error };
      }
      const remaining = { ...current };
      delete remaining[field];
      return remaining;
    });
    return error === null;
  }, [getDraftFieldError]);

  const focusInvalidDraftField = useCallback((field: CustomDashboardJsonDraftField): void => {
    setActiveTab(JSON_FIELD_TABS[field]);
    setEditorFocusRequest((current) => ({ field, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);

  const requestWorkspaceTransition = useCallback((transition: PendingWorkspaceTransition): void => {
    if (dirtyRef.current) {
      setPendingTransition(transition);
      return;
    }
    void transition.run();
  }, []);

  const commitProjectTransition = useCallback((nextProjectId: string | null): void => {
    setProjectId(nextProjectId);
    setDashboards([]);
    setSelectedDashboardId(null);
    setSelectedDashboard(null);
    setRevisions([]);
    setSelectedRevisionId(null);
    setDraft(null);
    setDraftErrors({});
    setEditorFocusRequest(null);
    resetValidationWorkspace();
  }, [resetValidationWorkspace]);

  const adoptCredentialReview = useCallback((review: CustomDashboardCredentialBindingReview): void => {
    setCredentialReview(review);
    setSelectedDashboard((current) => current?.id === review.dashboardId
      ? {
          ...current,
          credentialBindings: review.slots.flatMap((slotReview) => slotReview.binding ? [slotReview.binding] : []),
          credentialBindingRevision: review.credentialBindingRevision ?? current.credentialBindingRevision,
        }
      : current);
  }, []);

  const loadCredentialState = useCallback(async (
    nextProjectId: string,
    dashboardId: string,
    signal?: AbortSignal,
  ): Promise<CustomDashboardCredentialBindingReview | null> => {
    setCredentialLoading(true);
    setCredentialLoadError(null);
    try {
      const [review, credentials, health] = await Promise.all([
        fetchCustomDashboardCredentialBindings(nextProjectId, dashboardId, signal),
        fetchAutomationCredentials(nextProjectId, signal),
        fetchCredentialHealth(signal),
      ]);
      if (signal?.aborted) return null;
      setCredentialMetadata(credentials);
      setCredentialHealth(health);
      adoptCredentialReview(review);
      return review;
    } catch (error) {
      if (!signal?.aborted) {
        setCredentialLoadError(error instanceof Error ? error.message : "Credential metadata could not be loaded.");
      }
      return null;
    } finally {
      if (!signal?.aborted) setCredentialLoading(false);
    }
  }, [adoptCredentialReview]);

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
        setError(error instanceof Error ? error.message : translate(customDashboardMessages, "loadDashboardsFailed"));
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [initialPageState.dashboardId, setError, translate]);

  const loadDashboardDetail = useCallback(async (dashboardId: string, signal?: AbortSignal): Promise<void> => {
    try {
      const detail = await fetchCustomDashboard(dashboardId, signal);
      if (signal?.aborted) {
        return;
      }
      setSelectedDashboard(detail.dashboard);
      setDashboards((current) => current.map((dashboard) => dashboard.id === detail.dashboard.id ? detail.dashboard : dashboard));
      setRevisions(detail.revisions);
      const nextRevision = detail.revisions.find((revision) => revision.id === selectedRevisionIdRef.current)
        ?? selectLatestRevision(detail.revisions);
      setSelectedRevisionId(nextRevision?.id ?? null);
      if (!dirtyRef.current) {
        setDraft(dashboardToDraft(detail.dashboard));
        setDraftErrors({});
        setEditorFocusRequest(null);
        setSelectedFilePath(detail.dashboard.fileBundle.files[0]?.path ?? "src/dashboard.tsx");
      }
    } catch (error) {
      if (!signal?.aborted) {
        setError(error instanceof Error ? error.message : translate(customDashboardMessages, "loadDetailsFailed"));
      }
    }
  }, [setError, translate]);

  useEffect(() => {
    if (contextProjectId === projectId) {
      return;
    }
    const transition: PendingWorkspaceTransition = {
      key: `project:${contextProjectId ?? "none"}`,
      run: () => commitProjectTransition(contextProjectId),
    };
    requestWorkspaceTransition(transition);
  }, [commitProjectTransition, contextProjectId, projectId, requestWorkspaceTransition]);

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

  useEffect(() => {
    bindingActionControllerRef.current?.abort();
    credentialLoadControllerRef.current?.abort();
    setSavingCredentialSlotId(null);
    setCredentialSlotErrors({});
    setCredentialSlotAnnouncements({});
    if (!projectId || !selectedDashboardId || !hasCredentialSlots) {
      setCredentialReview(null);
      setCredentialMetadata([]);
      setCredentialHealth(null);
      setCredentialLoadError(null);
      setCredentialLoading(false);
      return;
    }
    const controller = new AbortController();
    credentialLoadControllerRef.current = controller;
    void loadCredentialState(projectId, selectedDashboardId, controller.signal).finally(() => {
      if (credentialLoadControllerRef.current === controller) credentialLoadControllerRef.current = null;
    });
    return () => {
      controller.abort();
      if (credentialLoadControllerRef.current === controller) credentialLoadControllerRef.current = null;
    };
  }, [hasCredentialSlots, loadCredentialState, projectId, selectedDashboardId]);

  const refreshSelectedDashboard = useCallback(async (): Promise<void> => {
    if (!selectedDashboardId) {
      return;
    }
    await loadDashboardDetail(selectedDashboardId);
  }, [loadDashboardDetail, selectedDashboardId]);

  const refreshCredentialState = useCallback((): void => {
    if (!projectId || !selectedDashboardId || !hasCredentialSlots) return;
    credentialLoadControllerRef.current?.abort();
    const controller = new AbortController();
    credentialLoadControllerRef.current = controller;
    void loadCredentialState(projectId, selectedDashboardId, controller.signal).finally(() => {
      if (credentialLoadControllerRef.current === controller) credentialLoadControllerRef.current = null;
    });
  }, [hasCredentialSlots, loadCredentialState, projectId, selectedDashboardId]);

  const completeCredentialMutation = useCallback(async (
    slotId: string,
    announcement: string,
    operation: (expectedBindingRevision: number, signal: AbortSignal) => Promise<CustomDashboardCredentialBindingReview>,
  ): Promise<void> => {
    if (!projectId || !selectedDashboardId || credentialReview?.credentialBindingRevision === null || credentialReview?.credentialBindingRevision === undefined) {
      setCredentialSlotErrors((current) => ({ ...current, [slotId]: "Refresh credential metadata before changing this binding." }));
      return;
    }
    bindingActionControllerRef.current?.abort();
    credentialLoadControllerRef.current?.abort();
    credentialLoadControllerRef.current = null;
    const controller = new AbortController();
    bindingActionControllerRef.current = controller;
    const mutationProjectId = projectId;
    const mutationDashboardId = selectedDashboardId;
    setSavingCredentialSlotId(slotId);
    setCredentialSlotErrors((current) => ({ ...current, [slotId]: "" }));
    setCredentialSlotAnnouncements((current) => ({ ...current, [slotId]: "" }));
    try {
      const review = await operation(credentialReview.credentialBindingRevision, controller.signal);
      if (controller.signal.aborted) return;
      adoptCredentialReview(review);
      setCredentialSlotAnnouncements((current) => ({ ...current, [slotId]: announcement }));
      validationIdentityRef.current += 1;
      setValidationSession(null);
      setLogs("");
      await loadDashboardDetail(mutationDashboardId, controller.signal);
      if (!controller.signal.aborted) {
        await loadCredentialState(mutationProjectId, mutationDashboardId, controller.signal);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof CustomDashboardCredentialBindingApiError && error.status === 409) {
        await loadDashboardDetail(mutationDashboardId, controller.signal);
        if (!controller.signal.aborted) {
          await loadCredentialState(mutationProjectId, mutationDashboardId, controller.signal);
          setCredentialSlotErrors((current) => ({
            ...current,
            [slotId]: "Bindings changed in another session. The dashboard was refreshed; review the current binding and explicitly retry your change.",
          }));
        }
      } else {
        const policyMessage = error instanceof CustomDashboardCredentialBindingApiError && error.issues.length > 0
          ? error.issues.map((issue) => issue.message).join(" ")
          : error instanceof Error
            ? error.message
            : "The credential binding could not be changed.";
        setCredentialSlotErrors((current) => ({ ...current, [slotId]: policyMessage }));
      }
    } finally {
      if (bindingActionControllerRef.current === controller) {
        bindingActionControllerRef.current = null;
        setSavingCredentialSlotId(null);
      }
    }
  }, [adoptCredentialReview, credentialReview?.credentialBindingRevision, loadCredentialState, loadDashboardDetail, projectId, selectedDashboardId]);

  const handleBindCredential = useCallback(async (slotId: string, credentialId: string): Promise<void> => {
    await completeCredentialMutation(
      slotId,
      "Credential binding saved. Validation and publication readiness were refreshed.",
      (expectedBindingRevision, signal) => bindCustomDashboardCredential(
        projectId ?? "",
        selectedDashboardId ?? "",
        { slotId, credentialId, expectedBindingRevision },
        signal,
      ),
    );
  }, [completeCredentialMutation, projectId, selectedDashboardId]);

  const handleUnbindCredential = useCallback(async (slotId: string): Promise<void> => {
    await completeCredentialMutation(
      slotId,
      "Credential unbound. Validation and publication readiness were refreshed.",
      (expectedBindingRevision, signal) => unbindCustomDashboardCredential(
        projectId ?? "",
        selectedDashboardId ?? "",
        slotId,
        expectedBindingRevision,
        signal,
      ),
    );
  }, [completeCredentialMutation, projectId, selectedDashboardId]);

  const buildDraftInput = useCallback((): UpdateCustomDashboardDraftInput & CreateCustomDashboardRevisionInput => {
    if (!draft) {
      throw new Error(translate(customDashboardMessages, "noDraftSelected"));
    }
    const manifest = parseJsonDraft<CustomDashboardManifest>(draft.manifestText, translate(customDashboardMessages, "manifestFieldName"), locale);
    const fileBundle = parseJsonDraft<CustomDashboardFileBundle>(draft.fileBundleText, translate(customDashboardMessages, "fileBundleFieldName"), locale);
    const sourceNodeGraph = parseJsonDraft<CustomDashboardDataSourceNodeGraph>(draft.sourceGraphText, translate(customDashboardMessages, "sourceGraphFieldName"), locale);
    const styleguide = parseJsonDraft<CustomDashboardJsonObject>(draft.styleguideText, translate(customDashboardMessages, "styleguideFieldName"), locale);
    const nextErrors: CustomDashboardDraftErrors = {
      ...(!manifest.ok ? { manifestText: manifest.message } : {}),
      ...(!fileBundle.ok ? { fileBundleText: fileBundle.message } : {}),
      ...(!sourceNodeGraph.ok ? { sourceGraphText: sourceNodeGraph.message } : {}),
      ...(!styleguide.ok ? { styleguideText: styleguide.message } : {}),
    };
    const firstInvalidField = (Object.keys(nextErrors) as CustomDashboardJsonDraftField[])[0];
    setDraftErrors(nextErrors);
    if (!manifest.ok || !fileBundle.ok || !sourceNodeGraph.ok || !styleguide.ok) {
      const invalidField = firstInvalidField ?? "manifestText";
      focusInvalidDraftField(invalidField);
      throw new DraftValidationError(nextErrors[invalidField] ?? translate(customDashboardMessages, "invalidDraftJson"));
    }
    return {
      title: draft.title.trim() || manifest.value.title || "Untitled Dashboard",
      description: draft.description,
      manifest: manifest.value,
      fileBundle: fileBundle.value,
      sourceNodeGraph: sourceNodeGraph.value,
      styleguide: styleguide.value,
    };
  }, [draft, focusInvalidDraftField, locale, translate]);

  const saveDraft = useCallback(async (): Promise<CustomDashboardRecord> => {
    if (!selectedDashboard) {
      throw new Error(translate(customDashboardMessages, "noDashboardSelected"));
    }
    const input = buildDraftInput();
    const updated = await updateCustomDashboardDraft(selectedDashboard.id, input);
    setSelectedDashboard(updated);
    setDashboards((current) => current.map((dashboard) => dashboard.id === updated.id ? updated : dashboard));
    setDraft(dashboardToDraft(updated));
    setDraftErrors({});
    setEditorFocusRequest(null);
    return updated;
  }, [buildDraftInput, selectedDashboard, translate]);

  const handleSaveDraft = async (): Promise<void> => {
    setSaving(true);
    clearFeedback();
    try {
      await saveDraft();
      setSuccess(translate(customDashboardMessages, "draftSaved"));
    } catch (error) {
      setError(error instanceof Error ? error.message : translate(customDashboardMessages, "saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const createDashboard = async (): Promise<void> => {
    if (!projectId) {
      return;
    }
    setCreating(true);
    clearFeedback();
    try {
      const created = await createCustomDashboard(projectId, createDefaultCustomDashboardDraft());
      setDashboards((current) => [created, ...current]);
      setSelectedDashboardId(created.id);
      setPageMode("editor");
      resetValidationWorkspace();
      setSuccess(translate(customDashboardMessages, "dashboardCreated"));
      await loadProjectDashboards(projectId);
    } catch (error) {
      setError(error instanceof Error ? error.message : translate(customDashboardMessages, "createFailed"));
    } finally {
      setCreating(false);
    }
  };

  const handleCreateDashboard = (): void => {
    requestWorkspaceTransition({
      key: "dashboard:create",
      run: createDashboard,
    });
  };

  const handleSelectDashboard = (dashboardId: string): void => {
    if (dashboardId === selectedDashboardId && pageMode === "editor") {
      return;
    }
    requestWorkspaceTransition({
      key: `dashboard:${dashboardId}`,
      run: () => {
        setSelectedDashboardId(dashboardId);
        setPageMode("editor");
        resetValidationWorkspace();
      },
    });
  };

  const handleOpenViewer = (): void => {
    requestWorkspaceTransition({
      key: "mode:viewer",
      run: () => setPageMode("viewer"),
    });
  };

  const handleKeepEditing = (): void => {
    const restoringProject = pendingTransition?.key.startsWith("project:") ?? false;
    setPendingTransition(null);
    if (restoringProject && projectId && contextProjectId !== projectId) {
      void selectProject(projectId).catch((error) => {
        setError(error instanceof Error ? error.message : translate(customDashboardMessages, "projectRestoreFailed"));
      });
    }
  };

  const handleDiscardAndContinue = async (): Promise<void> => {
    if (!pendingTransition) {
      return;
    }
    const transition = pendingTransition;
    setDiscardingTransition(true);
    setDraft(selectedDashboard ? dashboardToDraft(selectedDashboard) : null);
    setDraftErrors({});
    setEditorFocusRequest(null);
    setPendingTransition(null);
    try {
      await transition.run();
    } finally {
      setDiscardingTransition(false);
    }
  };

  const handleSaveAndContinue = async (): Promise<void> => {
    if (!pendingTransition) {
      return;
    }
    const transition = pendingTransition;
    setSaving(true);
    clearFeedback();
    try {
      await saveDraft();
      setPendingTransition(null);
      await transition.run();
    } catch (error) {
      setError(error instanceof Error ? error.message : translate(customDashboardMessages, "saveFailed"));
      if (error instanceof DraftValidationError) {
        setPendingTransition(null);
      }
    } finally {
      setSaving(false);
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
      resetValidationWorkspace();
      setSuccess(translate(customDashboardMessages, "revisionCreated", { number: revision.revisionNumber }));
      await refreshSelectedDashboard();
    } catch (error) {
      setError(error instanceof Error ? error.message : translate(customDashboardMessages, "revisionCreateFailed"));
    } finally {
      setCreatingRevision(false);
    }
  };

  const refreshLogs = useCallback(async (
    sessionId: string,
    signal?: AbortSignal,
    expectedIdentity?: number,
  ): Promise<boolean> => {
    setRefreshingLogs(true);
    try {
      const response = await fetchCustomDashboardValidationLogs(sessionId, 300, signal);
      if (signal?.aborted || (expectedIdentity !== undefined && validationIdentityRef.current !== expectedIdentity)) {
        return false;
      }
      setLogs(response.logs);
      return true;
    } catch (error) {
      if (!signal?.aborted && (expectedIdentity === undefined || validationIdentityRef.current === expectedIdentity)) {
        setPollingError(error instanceof Error ? error.message : translate(customDashboardMessages, "logsLoadFailed"));
        setPollingState("stale");
      }
      return false;
    } finally {
      if (!signal?.aborted) {
        setRefreshingLogs(false);
      }
    }
  }, [translate]);

  const handleStartValidation = async (): Promise<void> => {
    if (!projectId || !selectedDashboard || !selectedRevision) {
      return;
    }
    setValidating(true);
    setLogs("");
    setPollingError(null);
    clearFeedback();
    const validationIdentity = ++validationIdentityRef.current;
    const requestedDashboardId = selectedDashboard.id;
    const requestedRevisionId = selectedRevision.id;
    try {
      const session = await startCustomDashboardValidation(requestedDashboardId, requestedRevisionId, projectId);
      if (
        validationIdentityRef.current !== validationIdentity
        || session.dashboardId !== requestedDashboardId
        || session.revisionId !== requestedRevisionId
      ) {
        return;
      }
      announceValidationStatus(session);
      await refreshLogs(session.id, undefined, validationIdentity);
      if (validationIdentityRef.current !== validationIdentity) {
        return;
      }
      setValidationSession(session);
      setSuccess(translate(customDashboardMessages, "validationStarted"));
      if (terminalValidationStatuses.has(session.status)) {
        await refreshSelectedDashboard();
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : translate(customDashboardMessages, "validationStartFailed"));
    } finally {
      setValidating(false);
    }
  };

  useEffect(() => {
    if (!validationSession || terminalValidationStatuses.has(validationSession.status)) {
      retryPollRef.current = null;
      setPollingState("idle");
      return;
    }
    const sessionId = validationSession.id;
    const dashboardId = selectedDashboardId;
    const revisionId = validationSession.revisionId;
    const identity = ++validationIdentityRef.current;
    const controller = new AbortController();
    let intervalId: number | null = null;
    let inFlight = false;
    let consecutiveFailures = 0;
    let recovering = false;

    const isCurrent = (): boolean => (
      !controller.signal.aborted
      && validationIdentityRef.current === identity
    );

    const updatePollingState = (state: ValidationPollingState, message?: string): void => {
      if (!isCurrent()) {
        return;
      }
      setPollingState(state);
      if (message) {
        setPollingError(message);
      }
      if (pollingAnnouncementRef.current !== state) {
        pollingAnnouncementRef.current = state;
        const messageKey = state === "stale"
          ? "validationPollingStale"
          : state === "recovering"
            ? "validationPollingRecovering"
            : state === "failed"
              ? "validationPollingFailed"
              : "validationPollingActive";
        setValidationAnnouncement(translate(customDashboardMessages, messageKey));
      }
    };

    const pollOnce = async (): Promise<void> => {
      if (inFlight || !isCurrent()) {
        return;
      }
      inFlight = true;
      try {
        const session = await fetchCustomDashboardValidationSession(sessionId, controller.signal);
        if (
          !isCurrent()
          || session.id !== sessionId
          || session.dashboardId !== dashboardId
          || session.revisionId !== revisionId
        ) {
          return;
        }
        const logResponse = await fetchCustomDashboardValidationLogs(sessionId, 300, controller.signal);
        if (!isCurrent()) {
          return;
        }
        const hadFailures = consecutiveFailures > 0;
        consecutiveFailures = 0;
        setLogs(logResponse.logs);
        setPollingError(null);
        setValidationSession(session);
        announceValidationStatus(session);
        if (hadFailures) {
          recovering = true;
          updatePollingState("recovering");
        } else if (recovering) {
          recovering = false;
          updatePollingState("active");
        } else {
          updatePollingState("active");
        }
        if (terminalValidationStatuses.has(session.status)) {
          if (intervalId !== null) {
            window.clearInterval(intervalId);
            intervalId = null;
          }
          retryPollRef.current = null;
          setPollingState("idle");
          await refreshSelectedDashboard();
        }
      } catch (error) {
        if (!isCurrent()) {
          return;
        }
        consecutiveFailures += 1;
        const message = error instanceof Error ? error.message : translate(customDashboardMessages, "validationPollFailed");
        updatePollingState(consecutiveFailures >= 3 ? "failed" : "stale", message);
      } finally {
        inFlight = false;
      }
    };

    pollingAnnouncementRef.current = "idle";
    updatePollingState("active");
    retryPollRef.current = async () => {
      setRetryingPoll(true);
      try {
        await pollOnce();
      } finally {
        if (isCurrent()) {
          setRetryingPoll(false);
        }
      }
    };
    intervalId = window.setInterval(() => {
      void pollOnce();
    }, 2500);
    return () => {
      controller.abort();
      validationIdentityRef.current += 1;
      retryPollRef.current = null;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [announceValidationStatus, refreshSelectedDashboard, selectedDashboardId, translate, validationSession?.id]);

  const handleRefreshLogs = async (): Promise<void> => {
    if (validationSession) {
      await refreshLogs(validationSession.id, undefined, validationIdentityRef.current);
    }
  };

  const handleRetryValidationPoll = (): void => {
    void retryPollRef.current?.();
  };

  const handlePublish = async (): Promise<void> => {
    if (!selectedDashboard || !selectedRevision) {
      return;
    }
    setPublishing(true);
    clearFeedback();
    try {
      const validationSessionId = validationSession?.revisionId === selectedRevision.id ? validationSession.id : undefined;
      const published = await publishCustomDashboardRevision(selectedDashboard.id, selectedRevision.id, validationSessionId);
      setSelectedDashboard(published);
      setDashboards((current) => current.map((dashboard) => dashboard.id === published.id ? published : dashboard));
      setSuccess(translate(customDashboardMessages, "revisionPublished"));
      await refreshSelectedDashboard();
    } catch (error) {
      setError(error instanceof Error ? error.message : translate(customDashboardMessages, "publishFailed"));
    } finally {
      setPublishing(false);
    }
  };

  const handleArchive = async (): Promise<void> => {
    if (!selectedDashboard) {
      return;
    }
    const confirmed = await archiveConfirm.requestConfirm({
      title: translate(customDashboardMessages, "archiveTitle"),
      body: translate(customDashboardMessages, "archiveBody"),
      confirmLabel: translate(customDashboardMessages, "archive"),
      cancelLabel: translate(customDashboardMessages, "cancel"),
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
      setSuccess(translate(customDashboardMessages, "dashboardArchived"));
    } catch (error) {
      setError(error instanceof Error ? error.message : translate(customDashboardMessages, "archiveFailed"));
    } finally {
      setArchiving(false);
    }
  };

  const noProject = !projectLoading && !projectId;
  const showEmpty = !loading && projectId && dashboards.length === 0;

  return (
    <PageContainer aria-label={translate(customDashboardMessages, "workspaceAriaLabel")} padding="section" className="gap-6">
      <PageHeader
        icon={LayoutDashboard}
        eyebrow={translate(customDashboardMessages, "workspaceEyebrow")}
        title={translate(customDashboardMessages, "workspaceTitle")}
        subtitle={translate(customDashboardMessages, "workspaceSubtitle")}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={RefreshCw} onClick={() => projectId && void loadProjectDashboards(projectId)} disabled={!projectId} pending={loading}>
              {translate(customDashboardMessages, "refresh")}
            </Button>
            <Button
              icon={ExternalLink}
              onClick={handleOpenViewer}
              disabled={!selectedDashboard}
              disabledReason={translate(customDashboardMessages, "openPublishedDisabled")}
            >
              {translate(customDashboardMessages, "openPublished")}
            </Button>
            <Button icon={Save} variant="signal" onClick={() => void handleSaveDraft()} disabled={!selectedDashboard || !dirty || selectedDashboard.status === "archived"} pending={saving}>
              {translate(customDashboardMessages, "saveDraft")}
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
          title={translate(customDashboardMessages, "selectProjectTitle")}
          description={translate(customDashboardMessages, "selectProjectDescription")}
        />
      ) : null}

      {showEmpty ? (
        <EmptyState
          icon={<LayoutDashboard className="h-8 w-8" aria-hidden="true" />}
          title={translate(customDashboardMessages, "emptyTitle")}
          description={translate(customDashboardMessages, "emptyDescription")}
          primaryAction={<Button icon={LayoutDashboard} variant="signal" pending={creating} onClick={handleCreateDashboard}>{translate(customDashboardMessages, "createDashboard")}</Button>}
        />
      ) : null}

      {loading && dashboards.length === 0 && projectId ? (
        <div className="rounded-[1.4rem] border border-black/[0.08] bg-white/70 p-8 text-sm font-semibold text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-400">
          {translate(customDashboardMessages, "loadingDashboards")}
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
            onSelect={handleSelectDashboard}
            onCreate={handleCreateDashboard}
            creating={creating}
          />
          {pageMode === "viewer" ? (
            <CustomDashboardViewer
              dashboard={selectedDashboard}
              revisions={revisions}
              onRefresh={() => void refreshSelectedDashboard()}
              onReturnToEditor={() => setPageMode("editor")}
              refreshing={loading}
            />
          ) : (
            <>
              <CustomDashboardEditorPanel
                dashboardId={selectedDashboard.id}
                draft={draft}
                onDraftChange={setDraft}
                activeTab={activeTab}
                onActiveTabChange={setActiveTab}
                selectedFilePath={selectedFilePath}
                onSelectedFilePathChange={setSelectedFilePath}
                catalog={catalog}
                errors={draftErrors}
                focusRequest={editorFocusRequest}
                onValidateField={validateDraftField}
                credentialPanel={hasCredentialSlots ? (
                  <CustomDashboardCredentialSlotsPanel
                    projectId={projectId}
                    dashboardId={selectedDashboard.id}
                    review={credentialReview}
                    credentials={credentialMetadata}
                    health={credentialHealth}
                    loading={credentialLoading}
                    loadError={credentialLoadError}
                    savingSlotId={savingCredentialSlotId}
                    slotErrors={credentialSlotErrors}
                    slotAnnouncements={credentialSlotAnnouncements}
                    onBind={handleBindCredential}
                    onUnbind={handleUnbindCredential}
                    onRefresh={refreshCredentialState}
                  />
                ) : undefined}
              />
              <CustomDashboardValidationPanel
                dashboard={selectedDashboard}
                revisions={revisions}
                selectedRevision={selectedRevision}
                selectedRevisionId={selectedRevisionId}
                onSelectedRevisionIdChange={(revisionId) => {
                  setSelectedRevisionId(revisionId);
                  resetValidationWorkspace();
                }}
                validationSession={validationSession}
                logs={logs}
                pollingState={pollingState}
                pollingError={pollingError}
                validationAnnouncement={validationAnnouncement}
                retryingPoll={retryingPoll}
                creatingRevision={creatingRevision}
                validating={validating}
                refreshingLogs={refreshingLogs}
                publishing={publishing}
                archiving={archiving}
                onCreateRevision={() => void handleCreateRevision()}
                onStartValidation={() => void handleStartValidation()}
                onRefreshLogs={() => void handleRefreshLogs()}
                onRetryPoll={handleRetryValidationPoll}
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
          {translate(customDashboardMessages, "detailsUnavailable")}
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={archiveConfirm.isOpen}
        options={archiveConfirm.options}
        onConfirm={archiveConfirm.handleConfirm}
        onCancel={archiveConfirm.handleCancel}
      />
      {pendingTransition ? (
        <UnsavedChangesModal
          onConfirm={() => void handleDiscardAndContinue()}
          onCancel={handleKeepEditing}
          onSave={() => void handleSaveAndContinue()}
          saving={saving}
          discarding={discardingTransition}
        />
      ) : null}
    </PageContainer>
  );
};
