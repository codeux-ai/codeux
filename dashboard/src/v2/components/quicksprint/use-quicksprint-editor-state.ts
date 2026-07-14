import { useState, useCallback } from "preact/hooks";
import type { QuicksprintTemplateRecord } from "../../../../../src/contracts/quicksprint-types.js";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { clampSubtaskSliderValue } from "./quicksprint-shared.js";
import { useDashboardI18n } from "../../i18n/context.js";
import { sprintAuthoringMessages } from "../../i18n/messages/sprint-authoring.js";

export function useQuicksprintEditorState({
  templates,
  onCreateTemplate,
  onUpdateTemplate,
  onDeleteTemplate,
  onCancel,
  onStatus,
  onError,
}: {
  templates: QuicksprintTemplateRecord[];
  onCreateTemplate?: (data: {
    name: string;
    description: string;
    icon: string;
    category: string;
    categoryColor?: string;
    agentInstructionMarkdown: string;
    defaultTaskCount: number;
    agentPresetId?: string;
  }) => Promise<void>;
  onUpdateTemplate?: (templateId: string, data: {
    name: string;
    description: string;
    icon: string;
    category: string;
    categoryColor?: string;
    agentInstructionMarkdown: string;
    defaultTaskCount: number;
    agentPresetId?: string;
  }) => Promise<void>;
  onDeleteTemplate?: (templateId: string) => Promise<void>;
  onCancel: () => void;
  onStatus?: (message: string) => void;
  onError?: (message: string) => void;
}) {
  const { translate } = useDashboardI18n();
  const [editorTemplate, setEditorTemplate] = useState<QuicksprintTemplateRecord | null>(null);
  const [edName, setEdName] = useState("");
  const [edDescription, setEdDescription] = useState("");
  const [edIcon, setEdIcon] = useState("Zap");
  const [edCategory, setEdCategory] = useState("engineering");
  const [edCategoryColor, setEdCategoryColor] = useState("#22c55e");
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);

  const updateShowIconPicker = useCallback((open: boolean) => {
    setShowIconPicker(open);
    if (open) {
      setShowColorPicker(false);
      onStatus?.(translate(sprintAuthoringMessages, "iconPickerOpened"));
    } else {
      onStatus?.(translate(sprintAuthoringMessages, "iconPickerClosed"));
    }
  }, [onStatus, translate]);

  const updateShowColorPicker = useCallback((open: boolean) => {
    setShowColorPicker(open);
    if (open) {
      setShowIconPicker(false);
      onStatus?.(translate(sprintAuthoringMessages, "colorPickerOpened"));
    } else {
      onStatus?.(translate(sprintAuthoringMessages, "colorPickerClosed"));
    }
  }, [onStatus, translate]);

  const updateEditorIcon = useCallback((value: string) => {
    setEdIcon(value);
    onStatus?.(translate(sprintAuthoringMessages, "templateIconChanged", { value }));
  }, [onStatus, translate]);

  const updateEditorCategoryColor = useCallback((value: string) => {
    setEdCategoryColor(value);
    onStatus?.(translate(sprintAuthoringMessages, "templateColorChanged", { value }));
  }, [onStatus, translate]);

  const iconPickerRef = useFocusTrap(showIconPicker, { onClose: () => updateShowIconPicker(false), restoreFocus: true });
  const colorPickerRef = useFocusTrap(showColorPicker, { onClose: () => updateShowColorPicker(false), restoreFocus: true });

  const [pickerPos, setPickerPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [edInstruction, setEdInstruction] = useState("");
  const [edTaskCount, setEdTaskCount] = useState(5);
  const [edAgentPresetId, setEdAgentPresetId] = useState("");
  const [edSaving, setEdSaving] = useState(false);
  const [edConfirmDelete, setEdConfirmDelete] = useState(false);

  const openEditor = useCallback((t: QuicksprintTemplateRecord | null) => {
    setEditorTemplate(t);
    setEdName(t ? t.name : "");
    setEdDescription(t ? t.description : "");
    setEdIcon(t ? t.icon : "Zap");
    setEdCategory(t ? t.category : "engineering");
    setEdCategoryColor(t ? t.categoryColor || "#22c55e" : "#22c55e");
    setEdInstruction(t ? t.agentInstructionMarkdown || "" : "");
    setEdTaskCount(clampSubtaskSliderValue(t ? t.defaultTaskCount || 5 : 5));
    setEdAgentPresetId(t ? t.agentPresetId || "" : "");
    setEdSaving(false);
    setEdConfirmDelete(false);
    setShowColorPicker(false);
    setShowIconPicker(false);
  }, []);

  const handleEditorSave = useCallback(async () => {
    try {
      setEdSaving(true);
      onStatus?.(editorTemplate
        ? translate(sprintAuthoringMessages, "savingTemplateChanges", { name: edName })
        : translate(sprintAuthoringMessages, "creatingTemplateNamed", { name: edName || translate(sprintAuthoringMessages, "template") }));
      if (editorTemplate) {
        await onUpdateTemplate?.(editorTemplate.id, {
          name: edName,
          description: edDescription,
          icon: edIcon,
          category: edCategory,
          categoryColor: edCategoryColor,
          agentInstructionMarkdown: edInstruction,
          defaultTaskCount: clampSubtaskSliderValue(edTaskCount),
          agentPresetId: edAgentPresetId || undefined,
        });
      } else {
        await onCreateTemplate?.({
          name: edName,
          description: edDescription,
          icon: edIcon,
          category: edCategory,
          categoryColor: edCategoryColor,
          agentInstructionMarkdown: edInstruction,
          defaultTaskCount: clampSubtaskSliderValue(edTaskCount),
          agentPresetId: edAgentPresetId || undefined,
        });
      }
      onStatus?.(translate(
        sprintAuthoringMessages,
        editorTemplate ? "templateSavedNamed" : "templateCreatedNamed",
        { name: edName },
      ));
      onCancel();
    } catch (err) {
      console.error("Failed to save template", err);
      onError?.(translate(sprintAuthoringMessages, "templateSaveFailed", {
        name: edName || translate(sprintAuthoringMessages, "template"),
      }));
    } finally {
      setEdSaving(false);
    }
  }, [
    editorTemplate,
    edName,
    edDescription,
    edIcon,
    edCategory,
    edCategoryColor,
    edInstruction,
    edTaskCount,
    edAgentPresetId,
    onUpdateTemplate,
    onCreateTemplate,
    onCancel,
    onStatus,
    onError,
    translate,
  ]);

  const handleEditorDelete = useCallback(async () => {
    if (!editorTemplate) return;
    if (!edConfirmDelete) {
      setEdConfirmDelete(true);
      onStatus?.(translate(sprintAuthoringMessages, "confirmDeletionStatus", { name: editorTemplate.name }));
      return;
    }
    try {
      setEdSaving(true);
      onStatus?.(translate(sprintAuthoringMessages, "deletingTemplateStatus", { name: editorTemplate.name }));
      await onDeleteTemplate?.(editorTemplate.id);
      onStatus?.(translate(sprintAuthoringMessages, "deletedTemplateStatus", { name: editorTemplate.name }));
      onCancel();
    } catch (err) {
      console.error("Failed to delete template", err);
      onError?.(translate(sprintAuthoringMessages, "deleteTemplateFailed", { name: editorTemplate.name }));
    } finally {
      setEdSaving(false);
    }
  }, [editorTemplate, edConfirmDelete, onDeleteTemplate, onCancel, onStatus, onError, translate]);

  return {
    editorTemplate, setEditorTemplate,
    edName, setEdName,
    edDescription, setEdDescription,
    edIcon, setEdIcon: updateEditorIcon,
    edCategory, setEdCategory,
    edCategoryColor, setEdCategoryColor: updateEditorCategoryColor,
    showColorPicker, setShowColorPicker: updateShowColorPicker,
    showIconPicker, setShowIconPicker: updateShowIconPicker,
    iconPickerRef, colorPickerRef,
    pickerPos, setPickerPos,
    edInstruction, setEdInstruction,
    edTaskCount, setEdTaskCount,
    edAgentPresetId, setEdAgentPresetId,
    edSaving, setEdSaving,
    edConfirmDelete, setEdConfirmDelete,
    openEditor,
    handleEditorSave,
    handleEditorDelete
  };
}
