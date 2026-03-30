const fs = require('fs');
const code = fs.readFileSync('dashboard/src/v2/components/quicksprint/QuicksprintPanel.tsx', 'utf-8');

// 1. Add import `createContext`
let newCode = code.replace(/import { useState, useMemo, useEffect, useRef, useCallback } from "preact\/hooks";/, `import { useState, useMemo, useEffect, useRef, useCallback, useContext } from "preact/hooks";\nimport { createContext } from "preact";`);

// 2. Add QuicksprintContext definition
const contextCode = `
export interface QuicksprintContextValue {
  templates: QuicksprintTemplateRecord[];
  onCreateTemplate?: (data: any) => Promise<void>;
  onUpdateTemplate?: (templateId: string, data: any) => Promise<void>;
  onDeleteTemplate?: (templateId: string) => Promise<void>;
}

export const QuicksprintContext = createContext<QuicksprintContextValue>({
  templates: [],
});
`;
newCode = newCode.replace(/import { useExecutionTimeline } from "\.\.\/\.\.\/\.\.\/hooks\/ExecutionTimelineContext\.js";/, `import { useExecutionTimeline } from "../../../hooks/ExecutionTimelineContext.js";${contextCode}`);

// 3. Remove onCreate, onUpdate, onDelete from QuicksprintPanelProps
newCode = newCode.replace(/  onCreateTemplate\?: [\s\S]*?;\n/g, '');
newCode = newCode.replace(/  onUpdateTemplate\?: [\s\S]*?;\n/g, '');
newCode = newCode.replace(/  onDeleteTemplate\?: [\s\S]*?;\n/g, '');

// 4. Modify QuicksprintPanel component signature
newCode = newCode.replace(
  /export const QuicksprintPanel: FunctionComponent<QuicksprintPanelProps> = \({([\s\S]*?)}\) => {/,
  `export const QuicksprintPanel: FunctionComponent<QuicksprintPanelProps & Omit<QuicksprintContextValue, "templates">> = ({$1}) => {`
);

// 5. Wrap component return with Provider
// We find `return (` and `);` at the end of the component
const returnMatch = newCode.lastIndexOf('return (');
const endMatch = newCode.lastIndexOf('  );\n};');

if (returnMatch !== -1 && endMatch !== -1) {
  const innerContent = newCode.substring(returnMatch + 8, endMatch);
  const wrapper = `\n    <QuicksprintContext.Provider value={{ templates, onCreateTemplate, onUpdateTemplate, onDeleteTemplate }}>\n      ${innerContent}\n    </QuicksprintContext.Provider>\n`;
  newCode = newCode.substring(0, returnMatch + 8) + wrapper + newCode.substring(endMatch);
}

// 6. Fix handleEditorSave and handleEditorDelete
// Inside QuicksprintPanel, they currently use `onCreateTemplate` etc directly.
// But wait, since we passed them in the function parameters of `QuicksprintPanel: FunctionComponent<{...}> = ({ onCreateTemplate... })`,
// they are still in scope and the closures still work!
// BUT the task requires: "Have TemplateCard and the template editor sub-components consume template operations via useContext(QuicksprintContext) instead of receiving them as props."
// Since the editor is currently INLINE in QuicksprintPanel, it is technically consuming them from the closure, not via props.
// BUT to satisfy the instruction, we should extract the editor into a sub-component, OR use `useContext(QuicksprintContext)` right there? Wait!
// "out of the prop chain and into a co-located pattern that sub-components access directly."
// "Have TemplateCard and the template editor sub-components consume template operations via useContext"
// I will extract the EDITOR PHASE into a `TemplateEditor` component.
console.log("Ready to extract TemplateEditor component and modify QuicksprintPanel");
