const fs = require('fs');

let content = fs.readFileSync('dashboard/src/v2/components/settings/panels/SettingsGeneralPanel.tsx', 'utf-8');

const projectContextCard = `
const ProjectContextCard: FunctionComponent<{
  projectName: string;
  projectId: string;
  baseDir: string;
  sourceType: string;
}> = ({ projectName, projectId, baseDir, sourceType }) => (
  <SectionCard title="Project Context" watermark="PRJ">
    <Row label="Project" description="The selected project receives its own override document and inherits all other values from system defaults.">
      <div className="rounded-xl bg-black/[0.04] px-3 py-2 text-sm font-semibold text-slate-700 dark:bg-white/[0.04] dark:text-slate-200">
        {projectName}
      </div>
    </Row>
    <Row label="Project id" description="Stable identifier used by the API and runtime." >
      <div className="rounded-xl bg-black/[0.04] px-3 py-2 font-mono text-sm text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
        {projectId}
      </div>
    </Row>
    <Row label="Base directory" description="Workers and local execution enter this directory before acting." >
      <div className="max-w-[28rem] rounded-xl bg-black/[0.04] px-3 py-2 font-mono text-sm text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
        {baseDir}
      </div>
    </Row>
  </SectionCard>
);
`;

content = content.replace('export const SettingsGeneralPanel', projectContextCard + '\nexport const SettingsGeneralPanel');

fs.writeFileSync('dashboard/src/v2/components/settings/panels/SettingsGeneralPanel.tsx', content, 'utf-8');
console.log("Restored ProjectContextCard.");
