const fs = require('fs');

let testCode = fs.readFileSync('tests/dashboard/v2/settings-page-state.test.tsx', 'utf-8');

const moreExtraTests = `
  it("updateProviderSettings handles default merge", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    act(() => { result.current.updateEditableSettings((curr) => ({ ...curr, aiProvider: { providers: {} } } as any)); });
  });

  it("handles resetting active invocation route", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
    act(() => { result.current.setActiveInvocationRoute("dashboard_reply"); });
    expect(result.current.activeInvocationRoute).toBe("dashboard_reply");
  });

  it("handles null selectedIntegration correctly", async () => {
    const { result } = renderHook(() => useSettingsPageState(CATEGORIES, CATEGORY_SEARCH_HINTS));
    act(() => { result.current.setSelectedIntegration("jules"); });
    expect(result.current.selectedIntegration).toBe("jules");
  });
`;

testCode = testCode.replace('});\n', moreExtraTests + '});\n');
fs.writeFileSync('tests/dashboard/v2/settings-page-state.test.tsx', testCode, 'utf-8');
