import { useState, useCallback } from "preact/hooks";
import type { QuicksprintTemplateRecord } from "../../../../../src/contracts/quicksprint-types.js";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";

export function useQuicksprintEditorState({
  templates,
  onCreateTemplate,
  onUpdateTemplate,
  onDeleteTemplate,
  onCancel,
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
}) {
  const [editorTemplate, setEditorTemplate] = useState<QuicksprintTemplateRecord | null>(null);
  const [edName, setEdName] = useState("");
  const [edDescription, setEdDescription] = useState("");
  const [edIcon, setEdIcon] = useState("Zap");
  const [edCategory, setEdCategory] = useState("engineering");
  const [edCategoryColor, setEdCategoryColor] = useState("#22c55e");
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);

  const iconPickerRef = useFocusTrap(showIconPicker, { onClose: () => setShowIconPicker(false), restoreFocus: true });
  const colorPickerRef = useFocusTrap(showColorPicker, { onClose: () => setShowColorPicker(false), restoreFocus: true });

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
    setEdTaskCount(t ? t.defaultTaskCount || 5 : 5);
    setEdAgentPresetId(t ? t.agentPresetId || "" : "");
    setEdSaving(false);
    setEdConfirmDelete(false);
    setShowColorPicker(false);
    setShowIconPicker(false);
  }, []);

  const handleEditorSave = useCallback(async () => {
    try {
      setEdSaving(true);
      if (editorTemplate) {
        await onUpdateTemplate?.(editorTemplate.id, {
          name: edName,
          description: edDescription,
          icon: edIcon,
          category: edCategory,
          categoryColor: edCategoryColor,
          agentInstructionMarkdown: edInstruction,
          defaultTaskCount: edTaskCount,
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
          defaultTaskCount: edTaskCount,
          agentPresetId: edAgentPresetId || undefined,
        });
      }
      onCancel();
    } catch (err) {
      console.error("Failed to save template", err);
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
  ]);

  const handleEditorDelete = useCallback(async () => {
    if (!editorTemplate) return;
    if (!edConfirmDelete) {
      setEdConfirmDelete(true);
      return;
    }
    try {
      setEdSaving(true);
      await onDeleteTemplate?.(editorTemplate.id);
      onCancel();
    } catch (err) {
      console.error("Failed to delete template", err);
    } finally {
      setEdSaving(false);
    }
  }, [editorTemplate, edConfirmDelete, onDeleteTemplate, onCancel]);

  return {
    editorTemplate, setEditorTemplate,
    edName, setEdName,
    edDescription, setEdDescription,
    edIcon, setEdIcon,
    edCategory, setEdCategory,
    edCategoryColor, setEdCategoryColor,
    showColorPicker, setShowColorPicker,
    showIconPicker, setShowIconPicker,
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
