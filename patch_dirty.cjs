const fs = require('fs');
const file = 'dashboard/src/v2/BrowserPage.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  `                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">\n                  {script?.mode === "script" ? "Custom file" : "Auto-generated fallback"}\n                </div>`,
  `                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">\n                  {script?.mode === "script" ? "Custom file" : "Auto-generated fallback"}\n                  {scriptDraft !== (script?.content || "") && (\n                    <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-400">\n                      (Unsaved changes)\n                    </span>\n                  )}\n                </div>`
);

fs.writeFileSync(file, code);
