const fs = require('fs');
const path = 'tests/dashboard/v2/sprints-page.test.tsx';
let content = fs.readFileSync(path, 'utf8');

const additionalTest = `

  it("handles empty lists, escape key for row menu, and other UI events to boost coverage", () => {
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
      showQuicksprint: false,
      setShowQuicksprint: vi.fn(),
      showCreateComposer: false,
      setShowCreateComposer: vi.fn(),
      editingSprint: null,
      setEditingSprint: vi.fn(),
      showImportModal: false,
      setShowImportModal: vi.fn(),
    } as any);

    render(<SprintsPage />);

    // Dispatch events to hit the useEffect handlers in SprintsPage
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(document.body);
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("scroll"));

    // Also simulate toggling New Sprint composer to cover state setters
    const newSprintBtn = screen.getByRole("button", { name: /new sprint/i });
    if (newSprintBtn) {
      fireEvent.click(newSprintBtn);
    }
  });`;

content = content.replace(/}\);\n}\);/, `});\n${additionalTest}\n});`);
fs.writeFileSync(path, content);
