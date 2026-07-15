import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { Database, FileCheck2, Loader2, Pencil, Plus, Trash2, X } from "lucide-preact";
import type { SkillStorageContentsResponse, SkillStorageRecord } from "../../../../../src/contracts/skill-types.js";
import { useDashboardI18n } from "../../i18n/index.js";
import { settingsAgentsGuidanceMessages } from "../../i18n/messages/settings-agents-guidance.js";
import {
  createSkillStorage,
  deleteSkillStorage,
  fetchSkillStorageContents,
  fetchSkillStorages,
  updateSkillStorage,
} from "../../lib/agent-preset-api.js";
import { ActionFeedbackRegion } from "../ui/ActionFeedbackRegion.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import { Modal } from "../ui/Modal.js";

type FeedbackStatus = "idle" | "pending" | "success" | "error";

interface ProjectSummary {
  id: string;
  name: string;
}

interface PersistentSkillStorageManagerProps {
  project: ProjectSummary | null;
  storages: SkillStorageRecord[];
  onStoragesChange: (storages: SkillStorageRecord[]) => void;
}

interface StorageDraft {
  name: string;
  description: string;
}

const getErrorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export const PersistentSkillStorageManager: FunctionComponent<PersistentSkillStorageManagerProps> = ({
  project,
  storages,
  onStoragesChange,
}) => {
  const { translate, translatePlural } = useDashboardI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [storageList, setStorageList] = useState<SkillStorageRecord[]>(storages);
  const [contentsByStorageId, setContentsByStorageId] = useState<Record<string, SkillStorageContentsResponse | null>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [mutation, setMutation] = useState<string | null>(null);
  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackStatus>("idle");
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState<StorageDraft>({ name: "", description: "" });
  const [editingStorageId, setEditingStorageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<StorageDraft>({ name: "", description: "" });
  const [deleteTarget, setDeleteTarget] = useState<SkillStorageRecord | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const addNameRef = useRef<HTMLInputElement>(null);

  const isMutationPending = mutation !== null;

  useEffect(() => {
    setStorageList(storages);
  }, [storages]);

  const loadStorages = useCallback(async (announceLoading = true): Promise<void> => {
    if (!project) {
      setStorageList([]);
      setContentsByStorageId({});
      return;
    }

    if (announceLoading) {
      setIsLoading(true);
      setFeedbackStatus("pending");
      setFeedbackMessage(translate(settingsAgentsGuidanceMessages, "storageLoadingProject"));
    }

    try {
      const nextStorages = await fetchSkillStorages(project.id);
      setStorageList(nextStorages);
      onStoragesChange(nextStorages);
      const contentResults = await Promise.all(nextStorages.map(async (storage) => {
        try {
          return [storage.id, await fetchSkillStorageContents(project.id, storage.id)] as const;
        } catch {
          return [storage.id, null] as const;
        }
      }));
      setContentsByStorageId(Object.fromEntries(contentResults));
      if (announceLoading) {
        setFeedbackStatus("idle");
        setFeedbackMessage(null);
      }
    } catch (error) {
      setFeedbackStatus("error");
      setFeedbackMessage(translate(settingsAgentsGuidanceMessages, "storageLoadError", { error: getErrorMessage(error) }));
    } finally {
      if (announceLoading) setIsLoading(false);
    }
  }, [onStoragesChange, project?.id, project?.name, translate]);

  useEffect(() => {
    if (!isOpen) return;
    setEditingStorageId(null);
    setDeleteTarget(null);
    setFeedbackStatus("idle");
    setFeedbackMessage(null);
    void loadStorages();
  }, [isOpen, loadStorages, project?.id]);

  const createStorage = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (!project || isMutationPending) return;
    const name = createDraft.name.trim();
    if (!name) {
      setFeedbackStatus("error");
      setFeedbackMessage(translate(settingsAgentsGuidanceMessages, "storageNameRequired"));
      addNameRef.current?.focus();
      return;
    }

    setMutation("create");
    setFeedbackStatus("pending");
    setFeedbackMessage(translate(settingsAgentsGuidanceMessages, "storageCreatingName", { name }));
    try {
      const created = await createSkillStorage(project.id, { name, description: createDraft.description.trim(), storageKind: "project" });
      const nextStorages = [...storageList, created];
      setStorageList(nextStorages);
      onStoragesChange(nextStorages);
      try {
        const contents = await fetchSkillStorageContents(project.id, created.id);
        setContentsByStorageId((current) => ({ ...current, [created.id]: contents }));
      } catch {
        setContentsByStorageId((current) => ({ ...current, [created.id]: null }));
      }
      setCreateDraft({ name: "", description: "" });
      setFeedbackStatus("success");
      setFeedbackMessage(translate(settingsAgentsGuidanceMessages, "storageCreated", { name, project: project.name }));
    } catch (error) {
      setFeedbackStatus("error");
      setFeedbackMessage(translate(settingsAgentsGuidanceMessages, "storageCreateError", { name, error: getErrorMessage(error) }));
    } finally {
      setMutation(null);
    }
  };

  const beginEdit = (storage: SkillStorageRecord): void => {
    if (isMutationPending) return;
    setEditingStorageId(storage.id);
    setEditDraft({ name: storage.name, description: storage.description });
    setFeedbackStatus("idle");
    setFeedbackMessage(null);
  };

  const saveEdit = async (event: Event, storage: SkillStorageRecord): Promise<void> => {
    event.preventDefault();
    if (!project || isMutationPending) return;
    const name = editDraft.name.trim();
    if (!name) {
      setFeedbackStatus("error");
      setFeedbackMessage(translate(settingsAgentsGuidanceMessages, "storageNameRequired"));
      return;
    }

    setMutation(`edit:${storage.id}`);
    setFeedbackStatus("pending");
    setFeedbackMessage(translate(settingsAgentsGuidanceMessages, "storageSavingName", { name: storage.name }));
    try {
      const updated = await updateSkillStorage(project.id, storage.id, { name, description: editDraft.description.trim() });
      const nextStorages = storageList.map((candidate) => candidate.id === updated.id ? updated : candidate);
      setStorageList(nextStorages);
      onStoragesChange(nextStorages);
      setEditingStorageId(null);
      setFeedbackStatus("success");
      setFeedbackMessage(translate(settingsAgentsGuidanceMessages, "storageUpdated", { name }));
    } catch (error) {
      setFeedbackStatus("error");
      setFeedbackMessage(translate(settingsAgentsGuidanceMessages, "storageUpdateError", { name: storage.name, error: getErrorMessage(error) }));
    } finally {
      setMutation(null);
    }
  };

  const requestDelete = (storage: SkillStorageRecord, trigger: HTMLButtonElement): void => {
    if (isMutationPending) return;
    deleteTriggerRef.current = trigger;
    trigger.focus();
    setDeleteTarget(storage);
  };

  const closeDeleteDialog = (): void => {
    setDeleteTarget(null);
    window.setTimeout(() => deleteTriggerRef.current?.focus(), 0);
  };

  const confirmDelete = async (): Promise<void> => {
    if (!project || !deleteTarget || isMutationPending) return;
    const target = deleteTarget;
    setMutation(`delete:${target.id}`);
    setFeedbackStatus("pending");
    setFeedbackMessage(translate(settingsAgentsGuidanceMessages, "storageDeletingName", { name: target.name }));
    try {
      await deleteSkillStorage(project.id, target.id);
      const nextStorages = storageList.filter((storage) => storage.id !== target.id);
      setStorageList(nextStorages);
      onStoragesChange(nextStorages);
      setContentsByStorageId((current) => {
        const next = { ...current };
        delete next[target.id];
        return next;
      });
      setDeleteTarget(null);
      setFeedbackStatus("success");
      setFeedbackMessage(translate(settingsAgentsGuidanceMessages, "storageDeleted", { name: target.name }));
    } catch (error) {
      setDeleteTarget(null);
      setFeedbackStatus("error");
      setFeedbackMessage(translate(settingsAgentsGuidanceMessages, "storageDeleteError", { name: target.name, error: getErrorMessage(error) }));
      window.setTimeout(() => deleteTriggerRef.current?.focus(), 0);
    } finally {
      setMutation(null);
    }
  };

  const closeManager = (): void => {
    if (isMutationPending) return;
    setIsOpen(false);
  };

  return (
    <>
      <div className="grid w-full gap-3 rounded-[1.2rem] border border-black/[0.06] bg-black/[0.02] p-4 dark:border-white/[0.06] dark:bg-white/[0.025] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {project
              ? translatePlural(settingsAgentsGuidanceMessages, "storageSummary", storages.length)
              : translate(settingsAgentsGuidanceMessages, "storageUnavailable")}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {project
              ? translate(settingsAgentsGuidanceMessages, "storageDraftSeparation")
              : translate(settingsAgentsGuidanceMessages, "storageSelectProject")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-haspopup="dialog"
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-signal-500/25 bg-signal-500/[0.08] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-700 transition-colors hover:bg-signal-500/[0.14] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:text-signal-200"
        >
          <Database className="h-4 w-4" aria-hidden="true" />
          {translate(settingsAgentsGuidanceMessages, "storageManage")}
        </button>
      </div>

      <Modal
        isOpen={isOpen}
        onClose={closeManager}
        disableBackdropClick={isMutationPending}
        className="w-full max-w-5xl"
        ariaLabelledBy="persistent-skill-storage-manager-title"
        ariaDescribedBy="persistent-skill-storage-manager-description"
      >
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-black/[0.06] p-5 dark:border-white/[0.06] sm:p-6">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-signal-500/20 bg-signal-500/10 text-signal-600 dark:text-signal-300">
                  <Database className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-300">{translate(settingsAgentsGuidanceMessages, "storageProjectRecords")}</p>
                  <h2 id="persistent-skill-storage-manager-title" className="text-xl font-bold tracking-tight text-void-900 dark:text-white">{translate(settingsAgentsGuidanceMessages, "storageManagerTitle")}</h2>
                </div>
              </div>
              <p id="persistent-skill-storage-manager-description" className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {translate(settingsAgentsGuidanceMessages, "storageManagerDescription")}
              </p>
            </div>
            <button
              type="button"
              onClick={closeManager}
              disabled={isMutationPending}
              aria-label={translate(settingsAgentsGuidanceMessages, "storageCloseAria")}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-black/[0.08] text-slate-500 hover:bg-black/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 disabled:opacity-50 dark:border-white/[0.08] dark:hover:bg-white/[0.05]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
            {!project ? (
              <div className="rounded-[1.4rem] border border-dashed border-black/[0.08] bg-black/[0.02] p-8 text-center dark:border-white/[0.08] dark:bg-white/[0.025]">
                <Database className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
                <h3 className="mt-3 text-base font-semibold text-slate-800 dark:text-slate-100">{translate(settingsAgentsGuidanceMessages, "storageSelectProjectTitle")}</h3>
                <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-slate-500 dark:text-slate-400">{translate(settingsAgentsGuidanceMessages, "storageSelectProjectBody")}</p>
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-[minmax(240px,0.72fr)_minmax(0,1.6fr)]">
                <form onSubmit={(event) => void createStorage(event)} className="h-fit rounded-[1.35rem] border border-black/[0.06] bg-black/[0.02] p-4 dark:border-white/[0.06] dark:bg-white/[0.025] sm:p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                    <Plus className="h-4 w-4 text-signal-600" aria-hidden="true" /> {translate(settingsAgentsGuidanceMessages, "storageNew")}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{translate(settingsAgentsGuidanceMessages, "storageImmediateCreate")}</p>
                  <label className="mt-4 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {translate(settingsAgentsGuidanceMessages, "storageName")}
                    <input ref={addNameRef} value={createDraft.name} onInput={(event) => setCreateDraft((current) => ({ ...current, name: event.currentTarget.value }))} disabled={isMutationPending} required className="mt-1.5 w-full rounded-xl border border-black/[0.08] bg-white px-3 py-2.5 text-sm outline-none focus:border-signal-500/40 focus:ring-2 focus:ring-signal-500/20 disabled:opacity-50 dark:border-white/[0.09] dark:bg-void-900" />
                  </label>
                  <label className="mt-3 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {translate(settingsAgentsGuidanceMessages, "storageDescription")}
                    <textarea value={createDraft.description} onInput={(event) => setCreateDraft((current) => ({ ...current, description: event.currentTarget.value }))} disabled={isMutationPending} rows={3} className="mt-1.5 w-full resize-y rounded-xl border border-black/[0.08] bg-white px-3 py-2.5 text-sm outline-none focus:border-signal-500/40 focus:ring-2 focus:ring-signal-500/20 disabled:opacity-50 dark:border-white/[0.09] dark:bg-void-900" />
                  </label>
                  <button type="submit" disabled={isMutationPending || isLoading} className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-signal-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-signal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                    {mutation === "create" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                    {translate(settingsAgentsGuidanceMessages, mutation === "create" ? "storageCreating" : "storageCreate")}
                  </button>
                </form>

                <section aria-labelledby="project-storage-list-title" className="min-w-0">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h3 id="project-storage-list-title" className="text-sm font-semibold text-slate-800 dark:text-slate-100">{translate(settingsAgentsGuidanceMessages, "storageListTitle", { name: project.name })}</h3>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{translatePlural(settingsAgentsGuidanceMessages, "storageRecordCount", storageList.length)}</p>
                    </div>
                    {isLoading ? <span role="status" className="inline-flex items-center gap-2 text-xs font-semibold text-signal-700 dark:text-signal-300"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{translate(settingsAgentsGuidanceMessages, "storageLoading")}</span> : null}
                  </div>

                  {!isLoading && storageList.length === 0 ? (
                    <div className="mt-4 rounded-[1.25rem] border border-dashed border-black/[0.08] bg-black/[0.02] p-7 text-center dark:border-white/[0.08] dark:bg-white/[0.025]">
                      <FileCheck2 className="mx-auto h-7 w-7 text-slate-400" aria-hidden="true" />
                      <h4 className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-100">{translate(settingsAgentsGuidanceMessages, "storageEmptyTitle")}</h4>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{translate(settingsAgentsGuidanceMessages, "storageEmptyBody")}</p>
                    </div>
                  ) : (
                    <div className="mt-4 grid gap-3">
                      {storageList.map((storage) => {
                        const contents = contentsByStorageId[storage.id];
                        const contentLabel = contents === undefined
                          ? translate(settingsAgentsGuidanceMessages, "storageCheckingContent")
                          : contents === null
                            ? translate(settingsAgentsGuidanceMessages, "storageContentUnavailable")
                            : contents.skills.length === 0
                              ? translate(settingsAgentsGuidanceMessages, "storageNoContent")
                              : translatePlural(settingsAgentsGuidanceMessages, "storageSkillCount", contents.skills.length, {
                                suffix: contents.truncated ? "+" : "",
                              });
                        const isEditing = editingStorageId === storage.id;
                        return (
                          <article key={storage.id} className="rounded-[1.2rem] border border-black/[0.06] bg-white/75 p-4 dark:border-white/[0.07] dark:bg-white/[0.035]">
                            {isEditing ? (
                              <form onSubmit={(event) => void saveEdit(event, storage)}>
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">{translate(settingsAgentsGuidanceMessages, "storageName")}<input autoFocus value={editDraft.name} onInput={(event) => setEditDraft((current) => ({ ...current, name: event.currentTarget.value }))} disabled={isMutationPending} required className="mt-1.5 w-full rounded-xl border border-black/[0.08] bg-white px-3 py-2 text-sm outline-none focus:border-signal-500/40 focus:ring-2 focus:ring-signal-500/20 disabled:opacity-50 dark:border-white/[0.09] dark:bg-void-900" /></label>
                                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">{translate(settingsAgentsGuidanceMessages, "storageDescription")}<input value={editDraft.description} onInput={(event) => setEditDraft((current) => ({ ...current, description: event.currentTarget.value }))} disabled={isMutationPending} className="mt-1.5 w-full rounded-xl border border-black/[0.08] bg-white px-3 py-2 text-sm outline-none focus:border-signal-500/40 focus:ring-2 focus:ring-signal-500/20 disabled:opacity-50 dark:border-white/[0.09] dark:bg-void-900" /></label>
                                </div>
                                <div className="mt-3 flex flex-wrap justify-end gap-2">
                                  <button type="button" onClick={() => setEditingStorageId(null)} disabled={isMutationPending} className="min-h-9 rounded-xl border border-black/[0.08] px-3 py-1.5 text-xs font-bold text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 disabled:opacity-50 dark:border-white/[0.09] dark:text-slate-300">{translate(settingsAgentsGuidanceMessages, "storageCancelEdit")}</button>
                                  <button type="submit" disabled={isMutationPending} className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-signal-600 px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 disabled:opacity-50">{mutation === `edit:${storage.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}{translate(settingsAgentsGuidanceMessages, "storageSave")}</button>
                                </div>
                              </form>
                            ) : (
                              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0 flex-1">
                                  <h4 className="break-words text-sm font-semibold text-slate-800 dark:text-slate-100">{storage.name}</h4>
                                  <p className="mt-1 break-words text-xs leading-relaxed text-slate-500 dark:text-slate-400">{storage.description || translate(settingsAgentsGuidanceMessages, "storageNoDescription")}</p>
                                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-[0.12em]">
                                    <span className="rounded-full border border-black/[0.06] bg-black/[0.03] px-2.5 py-1 text-slate-500 dark:border-white/[0.07] dark:bg-white/[0.04] dark:text-slate-300">{translate(settingsAgentsGuidanceMessages, "storageKindLabel", { kind: storage.storageKind })}</span>
                                    <span className="rounded-full border border-signal-500/18 bg-signal-500/[0.07] px-2.5 py-1 text-signal-700 dark:text-signal-200">{contentLabel}</span>
                                  </div>
                                </div>
                                <div className="flex shrink-0 gap-2">
                                  <button type="button" onClick={() => beginEdit(storage)} disabled={isMutationPending} aria-label={translate(settingsAgentsGuidanceMessages, "storageEditAria", { name: storage.name })} className="flex h-10 w-10 items-center justify-center rounded-xl border border-black/[0.08] text-slate-600 hover:bg-black/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 disabled:opacity-50 dark:border-white/[0.09] dark:text-slate-300 dark:hover:bg-white/[0.05]"><Pencil className="h-4 w-4" aria-hidden="true" /></button>
                                  <button type="button" onClick={(event) => requestDelete(storage, event.currentTarget)} disabled={isMutationPending} aria-label={translate(settingsAgentsGuidanceMessages, "storageDeleteAria", { name: storage.name })} className="flex h-10 w-10 items-center justify-center rounded-xl border border-status-red/20 bg-status-red/[0.05] text-status-red hover:bg-status-red/[0.1] focus:outline-none focus-visible:ring-2 focus-visible:ring-status-red/30 disabled:opacity-50"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                                </div>
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            )}

            <ActionFeedbackRegion status={feedbackStatus} message={feedbackMessage} autoDismiss={false} className="mt-5" onDismiss={() => { setFeedbackStatus("idle"); setFeedbackMessage(null); }} />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        options={deleteTarget ? {
          title: translate(settingsAgentsGuidanceMessages, "storageDeleteTitle", { name: deleteTarget.name }),
          body: translate(settingsAgentsGuidanceMessages, "storageDeleteBody", { name: deleteTarget.name }),
          confirmLabel: translate(settingsAgentsGuidanceMessages, "storageDeleteConfirm"),
          cancelLabel: translate(settingsAgentsGuidanceMessages, "storageDeleteCancel"),
          destructive: true,
          requiredConfirmationText: deleteTarget.name,
          copy: {
            eyebrow: translate(settingsAgentsGuidanceMessages, "storageConfirmEyebrow"),
            destructiveWarning: translate(settingsAgentsGuidanceMessages, "storagePermanentWarning"),
            requiredConfirmationPrompt: translate(settingsAgentsGuidanceMessages, "storageTypeToContinue", { name: deleteTarget.name }),
            requiredConfirmationInputLabel: translate(settingsAgentsGuidanceMessages, "storageTypeToConfirm", { name: deleteTarget.name }),
            requiredConfirmationDisabledLabel: translate(settingsAgentsGuidanceMessages, "storageTypeToEnable", {
              name: deleteTarget.name,
              action: translate(settingsAgentsGuidanceMessages, "storageDeleteConfirm"),
            }),
            processing: translate(settingsAgentsGuidanceMessages, "storageProcessing"),
            processingWait: translate(settingsAgentsGuidanceMessages, "storageProcessingWait"),
          },
        } : null}
        onConfirm={confirmDelete}
        onCancel={closeDeleteDialog}
      />
    </>
  );
};
