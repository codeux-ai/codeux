const fs = require('fs');
const file = 'dashboard/src/v2/BrowserPage.tsx';
let code = fs.readFileSync(file, 'utf8');

// 1. Remove ActionFeedbackRegion and useActionFeedback imports
code = code.replace(
  `import { useActionFeedback } from "./hooks/use-action-feedback.js";\nimport { ActionFeedbackRegion } from "./components/ui/ActionFeedbackRegion.js";`,
  ``
);
code = code.replace(
  `import { useActionFeedback } from "../../hooks/use-action-feedback.js";`,
  ``
);

// 2. Add local action feedback state
code = code.replace(
  `  const browserFeedback = useActionFeedback();`,
  `  const [actionFeedback, setActionFeedback] = useState<{status: 'idle' | 'pending' | 'success' | 'error', message: string | null}>({status: 'idle', message: null});`
);

// 3. Replace all browserFeedback calls with setActionFeedback
code = code.replace(/browserFeedback\.setPending\(/g, `setActionFeedback({status: 'pending', message: `);
code = code.replace(/browserFeedback\.setSuccess\(/g, `setActionFeedback({status: 'success', message: `);
code = code.replace(/browserFeedback\.setError\(/g, `setActionFeedback({status: 'error', message: `);

// Also need to close the object literal for the replace.
// Wait, regex replacing method calls is tricky.
