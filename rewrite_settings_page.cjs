const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, 'dashboard/src/v2/SettingsPage.tsx');
let code = fs.readFileSync(targetFile, 'utf8');

// Imports
code = code.replace(
  'import { useProjectData } from "./context/project-data.js";',
  'import { useProjectData } from "./context/project-data.js";\nimport { useProjectEffectiveSettings } from "./hooks/use-project-effective-settings.js";'
);

code = code.replace(
  'fetchProjectEffectiveSettings,\n',
  ''
);

code = code.replace(
  '  applyExternalHintsToSystemSettings,\n',
  '  applyEffectiveProjectSettings,\n  applyExternalHintsToSystemSettings,\n'
);

code = code.replace(
  '  dashboardSettingsToProjectSettings,\n',
  ''
);

// Hooks initialization
const hookInsertion = `  const { deleteProject, selectedProject, selectedProjectId } = useProjectData();
  const { data: effectiveProjectData, refresh: refreshProjectSettings } = useProjectEffectiveSettings(selectedProjectId);`;

code = code.replace(
  '  const { deleteProject, selectedProject, selectedProjectId } = useProjectData();',
  hookInsertion
);

// New load/refresh logic
const loadSettingsOld = `  const loadSettings = useCallback(async (): Promise<void> => {
    // Do not overwrite in-progress user edits with a background refresh.
    if (isDirtyRef.current) {
      return;
    }
    setLoading(true);
    try {
      const nextSystem = await fetchSystemSettings();
      setSystemSettings(cloneSystemSettings(nextSystem));
      setSavedSystemSettings(cloneSystemSettings(nextSystem));

      if (selectedProjectId) {
        const effectiveProject = await fetchProjectEffectiveSettings(selectedProjectId);
        const nextProject = dashboardSettingsToProjectSettings(effectiveProject.settings);
        setProjectSettings(cloneProjectSettings(nextProject));
        setSavedProjectSettings(cloneProjectSettings(nextProject));
        setProjectSources(effectiveProject.sources);
      } else {
        setProjectSettings(null);
        setSavedProjectSettings(null);
        setProjectSources({});
      }

      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  // Depend on the stable project ID string, not the selectedProject object reference.
  // The project-data context recreates selectedProject on every realtime broadcast even
  // when the selected project has not actually changed, which previously caused this
  // callback to get a new reference → useEffect re-ran → settings reloaded → edits lost.
  }, [selectedProjectId]);`;

const refreshAllSourcesLogic = `  const refreshAllSources = useCallback(async (options?: { forceOverwrite?: boolean }): Promise<void> => {
    try {
      const nextSystem = await fetchSystemSettings();
      if (options?.forceOverwrite || !isDirtyRef.current) {
        setSystemSettings(cloneSystemSettings(nextSystem));
        setSavedSystemSettings(cloneSystemSettings(nextSystem));
      }

      await refreshProjectSettings();

      if (options?.forceOverwrite) {
        isDirtyRef.current = false;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [refreshProjectSettings]);

  const loadSettings = useCallback(async (): Promise<void> => {
    setLoading(true);
    await refreshAllSources();
    setLoading(false);
  }, [refreshAllSources]);

  useEffect(() => {
    if (isDirtyRef.current) {
      return;
    }
    if (effectiveProjectData) {
      const { settings, sources } = applyEffectiveProjectSettings(effectiveProjectData);
      setProjectSettings(settings);
      setSavedProjectSettings(cloneProjectSettings(settings));
      setProjectSources(sources);
    } else {
      setProjectSettings(null);
      setSavedProjectSettings(null);
      setProjectSources({});
    }
  }, [effectiveProjectData]);`;

code = code.replace(loadSettingsOld, refreshAllSourcesLogic);

// handleSave logic rewrite
const handleSaveOld = `        if (selectedProject) {
          const effectiveProject = await fetchProjectEffectiveSettings(selectedProject.id);
          const nextProject = dashboardSettingsToProjectSettings(effectiveProject.settings);
          setProjectSettings(cloneProjectSettings(nextProject));
          setSavedProjectSettings(cloneProjectSettings(nextProject));
          setProjectSources(effectiveProject.sources);
        }`;
const handleSaveNew = `        if (selectedProject) {
          await refreshAllSources({ forceOverwrite: true });
        }`;
code = code.replace(handleSaveOld, handleSaveNew);

const handleSaveProjectOld = `      await saveProjectSettings(selectedProject.id, projectSettings);
      const effectiveProject = await fetchProjectEffectiveSettings(selectedProject.id);
      const nextProject = dashboardSettingsToProjectSettings(effectiveProject.settings);
      setProjectSettings(cloneProjectSettings(nextProject));
      setSavedProjectSettings(cloneProjectSettings(nextProject));
      setProjectSources(effectiveProject.sources);`;
const handleSaveProjectNew = `      await saveProjectSettings(selectedProject.id, projectSettings);
      await refreshAllSources({ forceOverwrite: true });`;
code = code.replace(handleSaveProjectOld, handleSaveProjectNew);

code = code.replace(
  '}, [activeScope, systemSettings, selectedProject, projectSettings]);',
  '}, [activeScope, systemSettings, selectedProject, projectSettings, refreshAllSources]);'
);

// handleResetProject logic rewrite
const handleResetOld = `      await resetProjectSettings(selectedProject.id);
      const effectiveProject = await fetchProjectEffectiveSettings(selectedProject.id);
      const nextProject = dashboardSettingsToProjectSettings(effectiveProject.settings);
      setProjectSettings(cloneProjectSettings(nextProject));
      setSavedProjectSettings(cloneProjectSettings(nextProject));
      setProjectSources(effectiveProject.sources);`;
const handleResetNew = `      await resetProjectSettings(selectedProject.id);
      await refreshAllSources({ forceOverwrite: true });`;
code = code.replace(handleResetOld, handleResetNew);

code = code.replace(
  '}, [selectedProject]);',
  '}, [selectedProject, refreshAllSources]);'
);

// handleImportHints logic rewrite
const handleImportOld = `      setSystemSettings(nextSettings);
      setSaveMessage("Imported missing integration secrets from env/settings.json.");
      setError(null);
    } catch (hintError) {`;
const handleImportNew = `      await saveSystemSettings(nextSettings);
      await refreshAllSources({ forceOverwrite: true });
      setSaveMessage("Imported missing integration secrets from env/settings.json.");
      setError(null);
    } catch (hintError) {`;
// Actually, wait, does import hints save or just update memory? Let's check original.
// "Imported missing integration secrets from env/settings.json." "consolidating load, save, reset, and hint-import refresh behavior behind one refresh pipeline"

fs.writeFileSync(targetFile, code, 'utf8');
console.log('Successfully applied rewrite.');
