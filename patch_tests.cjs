const fs = require('fs');
const content = fs.readFileSync('tests/dashboard/v2/sprints-page.test.tsx', 'utf-8');

const newTest1 = `
  it("dismisses quicksprint when opening composer or edit flows", () => {
    const setShowQuicksprint = vi.fn();
    const setShowCreateComposer = vi.fn();
    const setEditingSprint = vi.fn();

    vi.mocked(useSprintsPageData).mockReturnValue({
      selectedProject: { id: "proj-1" },
      planningRoute: { available: true },
      sortedSprints: [],
      showcaseSprints: [],
      activeRunsBySprintId: new Map(),
      interventionBySprintId: new Map(),
      nextId: "spr-123",
      virtualProviders: [],
      pendingActionIds: new Set(),
      planningPresets: [],
      quicksprintTemplates: [],
      showQuicksprint: true,
      setShowQuicksprint,
      showCreateComposer: false,
      setShowCreateComposer,
      editingSprint: null,
      setEditingSprint,
      showImportModal: false,
      setShowImportModal: vi.fn(),
    } as any);

    render(<SprintsPage />);

    // Click New Sprint
    const newSprintBtn = screen.getAllByRole("button").find(b => b.textContent?.toLowerCase().includes("new sprint"));
    if (newSprintBtn) {
      fireEvent.click(newSprintBtn);
    }

    expect(setShowQuicksprint).toHaveBeenCalledWith(false);
  });
`;

const updatedContent = content.replace(
  'it("handles empty lists, escape key for row menu, and other UI events to boost coverage", () => {',
  `${newTest1}\n  it("handles empty lists, escape key for row menu, and other UI events to boost coverage", () => {`
);

fs.writeFileSync('tests/dashboard/v2/sprints-page.test.tsx', updatedContent);
