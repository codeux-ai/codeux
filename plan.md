1. **Explore File & Create Sub-Component**:
   Since the Template Editor is currently inline inside `QuicksprintPanel` (approx lines 540-800), we need to extract it into a separate component called `TemplateEditor` so it can act as a "sub-component" and consume the template operations.

2. **Context Creation**:
   - At the top of `dashboard/src/v2/components/quicksprint/QuicksprintPanel.tsx`, import `createContext` and `useContext`.
   - Create and export `QuicksprintContext` with the following type:
     ```tsx
     export interface QuicksprintContextValue {
       templates: QuicksprintTemplateRecord[];
       onCreateTemplate?: (data: any) => Promise<void>;
       onUpdateTemplate?: (templateId: string, data: any) => Promise<void>;
       onDeleteTemplate?: (templateId: string) => Promise<void>;
     }
     export const QuicksprintContext = createContext<QuicksprintContextValue>({ templates: [] });
     ```

3. **Prop Definition Updates**:
   - Remove `onCreateTemplate`, `onUpdateTemplate`, and `onDeleteTemplate` from `QuicksprintPanelProps`.
   - Update `QuicksprintPanel` signature to explicitly accept these three CRUD operations to allow the parent to pass them in, but NOT pass them through to sub-components:
     ```tsx
     export const QuicksprintPanel: FunctionComponent<
       QuicksprintPanelProps & Omit<QuicksprintContextValue, "templates">
     > = ({ ...
     ```

4. **Add Context Provider**:
   - Wrap the returned JSX from `QuicksprintPanel` in `<QuicksprintContext.Provider value={{ templates, onCreateTemplate, onUpdateTemplate, onDeleteTemplate }}> ... </QuicksprintContext.Provider>`.

5. **Consume Context in Sub-components**:
   - Update `TemplateCard` to use `const { onDeleteTemplate } = useContext(QuicksprintContext)` if needed, but the prompt says "Have TemplateCard and the template editor sub-components consume template operations via useContext(QuicksprintContext) instead of receiving them as props." Wait, `TemplateCard` doesn't use `onDeleteTemplate`. Does it? No, `TemplateCard` only gets `onEdit` and `onSelect`. We will just remove `onDeleteTemplate` passing or any CRUD if it exists, but it doesn't. We'll ensure `TemplateEditor` gets them via context.
   - For `TemplateEditor`, we will pass all the state variables like `edName`, `setEdName` etc as props to the new `TemplateEditor` component, or let `TemplateEditor` manage its own state!
   - Wait, `TemplateEditor` can manage its own local state (`edName`, `edDescription`, etc)! Currently `QuicksprintPanel` manages it. If we extract `TemplateEditor`, we can also move `edName`, `setEdName`, `edDescription`, etc. into `TemplateEditor`, which cleans up `QuicksprintPanel` significantly.
   - Inside `TemplateEditor`, we will consume `const { onCreateTemplate, onUpdateTemplate, onDeleteTemplate } = useContext(QuicksprintContext);` and perform the saves and deletes.

6. **Quality Gates & Submit**:
   - Run technical quality gates: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:coverage`, and `npm run build`.
   - Complete pre commit steps to ensure proper testing, verification, review, and reflection are done.
   - Submit the completed task.
